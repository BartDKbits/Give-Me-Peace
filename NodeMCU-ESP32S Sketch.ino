/*
  ESP32 SENSOR API (PULL) + LED COLOR ENDPOINT + 135x240 TFT LAYOUT (ESP32 core 3.x)

  Endpoints:
    GET  /                 -> HTML dashboard
    GET  /api/health       -> "OK"
    GET  /api/sensors      -> JSON sensor data (cached)
    GET  /api/refresh      -> force refresh now, returns JSON
    GET  /api/led?r=0-255&g=0-255&b=0-255   -> set LED PWM color
    GET  /api/led?hex=RRGGBB                -> set LED PWM color via hex
    GET  /api/buzzer?on=0|1                 -> force buzzer on/off
    GET  /api/alarm                         -> "ALARM=1" or "ALARM=0"
    GET  /api/threshold?sound=900&eco2=1200&tvoc=400

  Notes:
  - TFT is 135x240 (ST7789) — layout uses textSize=1 to fit width
  - RGB LED pins: R=GPIO26, G=GPIO13, B=GPIO27
  - If RGB is common-anode (common pin to 3.3V), set commonAnode=true
  - ESP32 has NO GPIO24. Buzzer is GPIO25
*/

#include <WiFi.h>
#include <WebServer.h>

#include <Wire.h>
#include <SPI.h>
#include <DHT.h>
#include "Adafruit_SGP30.h"
#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>

// -------------------- WIFI --------------------
const char* ssid     = "S23 FE";
const char* password = "gurgobar";

// -------------------- PINS --------------------
#define DHTPIN   14
#define DHTTYPE  DHT11

#define SOUND_PIN 34
#define LDR_PIN   35

#define I2C_SDA 21
#define I2C_SCL 22

#define TFT_CS   15
#define TFT_DC   2
#define TFT_RST  -1
#define TFT_BL   32
#define TFT_SCK  17
#define TFT_MOSI 16

// RGB pins (your wiring)
#define RED_PIN   26
#define GREEN_PIN 13
#define BLUE_PIN  27

#define BUZZER_PIN 12

// -------------------- RGB PWM (ESP32 core 3.x) --------------------
// New API: ledcAttach(pin, freq, resolution_bits) and ledcWrite(pin, duty)
const int PWM_FREQ = 5000;
const int PWM_RES  = 8;     // 0..255 duty

// -------------------- OBJECTS --------------------
WebServer server(80);
DHT dht(DHTPIN, DHTTYPE);
Adafruit_SGP30 sgp;
Adafruit_ST7789 tft(TFT_CS, TFT_DC, TFT_RST);

// -------------------- UPDATE INTERVAL --------------------
const uint32_t DATA_INTERVAL_MS = 500; // 0.5 seconds
uint32_t lastDataUpdate = 0;

// -------------------- SENSOR VALUES (CACHED) --------------------
float dhtTempC = NAN, dhtHum = NAN;
uint16_t sgpTVOC = 0, sgpECO2 = 0;
int soundPeakToPeak = 0;
int ldrRaw = 0;
float ldrVolts = 0;
bool sgpPresent = false;

// -------------------- THRESHOLDS --------------------
int SOUND_ALERT = 900;
int ECO2_ALERT  = 1200;
int TVOC_ALERT  = 400;

// -------------------- LED STATE --------------------
bool commonAnode = false;   // true if common pin goes to 3.3V
uint8_t ledR = 0, ledG = 0, ledB = 0;

// -------------------- BUZZER STATE --------------------
bool buzzerForced = false;

// -------------------- HELPERS --------------------
int clampInt(int v, int lo, int hi) { return (v < lo) ? lo : (v > hi ? hi : v); }

void applyLedPWM(uint8_t r, uint8_t g, uint8_t b) {
  ledR = r; ledG = g; ledB = b;

  // Common-anode LEDs need inverted PWM (255=off, 0=full on)
  uint8_t pr = commonAnode ? (uint8_t)(255 - r) : r;
  uint8_t pg = commonAnode ? (uint8_t)(255 - g) : g;
  uint8_t pb = commonAnode ? (uint8_t)(255 - b) : b;

  // ESP32 core 3.x writes by pin
  ledcWrite(RED_PIN, pr);
  ledcWrite(GREEN_PIN, pg);
  ledcWrite(BLUE_PIN, pb);
}

int readSoundPeakToPeak(uint32_t windowMs) {
  uint32_t start = millis();
  int signalMax = 0;
  int signalMin = 4095;

  while (millis() - start < windowMs) {
    int sample = analogRead(SOUND_PIN);
    if (sample >= 0 && sample <= 4095) {
      if (sample > signalMax) signalMax = sample;
      if (sample < signalMin) signalMin = sample;
    }
  }
  return signalMax - signalMin;
}

// -------------------- TFT --------------------
void displayInit() {
  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_BL, HIGH); // try LOW if backlight is active-low

  SPI.begin(TFT_SCK, -1, TFT_MOSI, TFT_CS);

  tft.init(135, 240);
  tft.setRotation(1); // portrait

  tft.fillScreen(ST77XX_BLACK);
  tft.setTextWrap(false);
}

bool shouldAlarm() {
  if (soundPeakToPeak > SOUND_ALERT) return true;
  if (sgpECO2 > ECO2_ALERT) return true;
  if (sgpTVOC > TVOC_ALERT) return true;
  return false;
}

void displayDraw() {
  tft.fillScreen(ST77XX_BLACK);
  tft.setTextColor(ST77XX_WHITE);
  tft.setTextSize(1);

  // Header
  tft.setCursor(4, 4);
  tft.print("ESP32 Sensor Dashboard");

  int startY = 20;
  int rowH = 16;

  int leftX  = 4;     // left column
  int rightX = 120;   // right column (fits 240 width nicely)

  int y = startY;

  // -------- LEFT COLUMN --------
  tft.setCursor(leftX, y);
  tft.print("Temp:");
  tft.print(isnan(dhtTempC) ? "--" : String(dhtTempC, 1));
  tft.print("C");

  tft.setCursor(leftX, y += rowH);
  tft.print("Hum:");
  tft.print(isnan(dhtHum) ? "--" : String((int)dhtHum));
  tft.print("%");

  tft.setCursor(leftX, y += rowH);
  tft.print("eCO2:");
  tft.print(sgpECO2);

  tft.setCursor(leftX, y += rowH);
  tft.print("TVOC:");
  tft.print(sgpTVOC);

  // Reset Y for right column
  y = startY;

  // -------- RIGHT COLUMN --------
  tft.setCursor(rightX, y);
  tft.print("Sound:");
  tft.print(soundPeakToPeak);

  tft.setCursor(rightX, y += rowH);
  tft.print("LDR:");
  tft.print(ldrRaw);

  tft.setCursor(rightX, y += rowH);
  tft.print("LED:");
  tft.print(ledR); tft.print(",");
  tft.print(ledG); tft.print(",");
  tft.print(ledB);

  tft.setCursor(rightX, y += rowH);
  tft.print("Alarm:");
  tft.print(shouldAlarm() ? "YES" : "no");

  // IP on bottom
  tft.setCursor(4, 120);
  tft.print("IP: ");
  tft.print(WiFi.localIP().toString());
}

// -------------------- JSON --------------------
String jsonSensors() {
  String j = "{";
  j += "\"ip\":\"" + WiFi.localIP().toString() + "\",";
  j += "\"rssi\":" + String(WiFi.RSSI()) + ",";

  j += "\"dht\":{";
  j += "\"tempC\":" + String(isnan(dhtTempC) ? -999.0 : dhtTempC, 1) + ",";
  j += "\"hum\":" + String(isnan(dhtHum) ? -999.0 : dhtHum, 0);
  j += "},";

  j += "\"sound\":{\"peakToPeak\":" + String(soundPeakToPeak) + "},";
  j += "\"ldr\":{\"raw\":" + String(ldrRaw) + ",\"volts\":" + String(ldrVolts, 2) + "},";

  j += "\"sgp30\":{";
  j += "\"present\":" + String(sgpPresent ? "true" : "false") + ",";
  j += "\"eco2\":" + String(sgpECO2) + ",";
  j += "\"tvoc\":" + String(sgpTVOC);
  j += "},";

  j += "\"thresholds\":{";
  j += "\"sound\":" + String(SOUND_ALERT) + ",";
  j += "\"eco2\":" + String(ECO2_ALERT) + ",";
  j += "\"tvoc\":" + String(TVOC_ALERT);
  j += "},";

  j += "\"led\":{";
  j += "\"r\":" + String(ledR) + ",";
  j += "\"g\":" + String(ledG) + ",";
  j += "\"b\":" + String(ledB) + ",";
  j += "\"commonAnode\":" + String(commonAnode ? "true" : "false");
  j += "},";

  j += "\"buzzerForced\":" + String(buzzerForced ? "true" : "false") + ",";
  j += "\"alarm\":" + String(shouldAlarm() ? "true" : "false") + ",";
  j += "\"lastUpdateMs\":" + String(lastDataUpdate);

  j += "}";
  return j;
}

String htmlPage() {
  String s;
  s += "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>";
  s += "<title>ESP32 API</title></head><body style='font-family:Arial;padding:16px'>";
  s += "<h2>ESP32 Sensor API</h2>";
  s += "<p><a href='/api/sensors'>/api/sensors</a></p>";
  s += "<p><a href='/api/refresh'>/api/refresh</a></p>";
  s += "<p>LED: <code>/api/led?r=255&g=0&b=128</code> or <code>/api/led?hex=FF0080</code></p>";
  s += "<p><a href='/api/alarm'>/api/alarm</a></p>";
  s += "<pre style='background:#f4f4f4;padding:10px;border-radius:8px;white-space:pre-wrap;'>";
  s += jsonSensors();
  s += "</pre>";
  s += "</body></html>";
  return s;
}

// -------------------- SENSOR REFRESH --------------------
void refreshSensorsNow() {
  soundPeakToPeak = readSoundPeakToPeak(50);

  ldrRaw = analogRead(LDR_PIN);
  ldrVolts = (ldrRaw / 4095.0f) * 3.3f;

  float h = dht.readHumidity();
  float t = dht.readTemperature();
  if (!isnan(h) && !isnan(t)) {
    dhtHum = h;
    dhtTempC = t;
  }

  if (sgpPresent) {
    if (sgp.IAQmeasure()) {
      sgpTVOC = sgp.TVOC;
      sgpECO2 = sgp.eCO2;
    }
  }

  lastDataUpdate = millis();
  displayDraw();
}

// -------------------- API HANDLERS --------------------
void handleRoot() { server.send(200, "text/html", htmlPage()); }
void handleHealth() { server.send(200, "text/plain", "OK"); }
void handleSensors() { server.send(200, "application/json", jsonSensors()); }
void handleAlarm() { server.send(200, "text/plain", shouldAlarm() ? "ALARM=1" : "ALARM=0"); }

void handleRefresh() {
  refreshSensorsNow();
  server.send(200, "application/json", jsonSensors());
}

// /api/led?r=0-255&g=0-255&b=0-255
// /api/led?hex=RRGGBB
void handleLed() {
  int r = (int)ledR, g = (int)ledG, b = (int)ledB;

  if (server.hasArg("hex")) {
    String hex = server.arg("hex");
    hex.replace("#", "");
    if (hex.length() == 6) {
      long val = strtol(hex.c_str(), nullptr, 16);
      r = (val >> 16) & 0xFF;
      g = (val >> 8) & 0xFF;
      b = val & 0xFF;
    }
  } else {
    if (server.hasArg("r")) r = server.arg("r").toInt();
    if (server.hasArg("g")) g = server.arg("g").toInt();
    if (server.hasArg("b")) b = server.arg("b").toInt();
  }

  r = clampInt(r, 0, 255);
  g = clampInt(g, 0, 255);
  b = clampInt(b, 0, 255);

  applyLedPWM((uint8_t)r, (uint8_t)g, (uint8_t)b);
  server.send(200, "application/json", jsonSensors());
}

void handleBuzzer() {
  int on = server.hasArg("on") ? server.arg("on").toInt() : 0;
  buzzerForced = true;
  digitalWrite(BUZZER_PIN, on ? HIGH : LOW);
  server.send(200, "text/plain", on ? "BUZZER=ON (forced)" : "BUZZER=OFF (forced)");
}

void handleThreshold() {
  if (server.hasArg("sound")) SOUND_ALERT = clampInt(server.arg("sound").toInt(), 0, 4095);
  if (server.hasArg("eco2"))  ECO2_ALERT  = clampInt(server.arg("eco2").toInt(), 400, 10000);
  if (server.hasArg("tvoc"))  TVOC_ALERT  = clampInt(server.arg("tvoc").toInt(), 0, 60000);
  server.send(200, "application/json", jsonSensors());
}

void handleNotFound() { server.send(404, "text/plain", "Not found"); }

// -------------------- SETUP --------------------
void setup() {
  Serial.begin(115200);
  delay(300);

  // Buzzer
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  // PWM attach (ESP32 core 3.x)
  ledcAttach(RED_PIN, PWM_FREQ, PWM_RES);
  ledcAttach(GREEN_PIN, PWM_FREQ, PWM_RES);
  ledcAttach(BLUE_PIN, PWM_FREQ, PWM_RES);
  applyLedPWM(0, 0, 0);

  // ADC
  analogReadResolution(12);
  analogSetPinAttenuation(SOUND_PIN, ADC_11db);
  analogSetPinAttenuation(LDR_PIN, ADC_11db);

  // Sensors
  dht.begin();
  Wire.begin(I2C_SDA, I2C_SCL);
  sgpPresent = sgp.begin();
  if (sgpPresent) {
    if (!sgp.IAQinit()) Serial.println("SGP30 IAQinit failed");
  } else {
    Serial.println("SGP30 not found (check SDA=21 SCL=22 3.3V GND).");
  }

  // TFT
  displayInit();
  displayDraw();

  // WiFi
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("ESP32 IP: ");
  Serial.println(WiFi.localIP());

  // Routes
  server.on("/", handleRoot);

  server.on("/api/health", handleHealth);
  server.on("/api/sensors", handleSensors);
  server.on("/api/refresh", handleRefresh);
  server.on("/api/alarm", handleAlarm);
  server.on("/api/led", handleLed);
  server.on("/api/buzzer", handleBuzzer);
  server.on("/api/threshold", handleThreshold);

  server.onNotFound(handleNotFound);

  server.begin();
  Serial.println("HTTP server started");

  refreshSensorsNow();
}

// -------------------- LOOP --------------------
void loop() {
  server.handleClient();

  uint32_t now = millis();
  if (now - lastDataUpdate >= DATA_INTERVAL_MS) {
    refreshSensorsNow();
    Serial.println("Auto refresh (30s) complete");
  }

  if (!buzzerForced) digitalWrite(BUZZER_PIN, LOW);
}