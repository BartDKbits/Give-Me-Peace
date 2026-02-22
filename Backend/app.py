from flask import Flask, jsonify, request
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, firestore

from google import genai
import os
from dotenv import load_dotenv

import time
import threading
import socket
import ipaddress
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed


# ---------------------------
# Setup
# ---------------------------
load_dotenv()

app = Flask(__name__)
CORS(
    app,
    resources={r"/api/*": {"origins": "http://localhost:5173"}},
    supports_credentials=False,
)

cred = credentials.Certificate("give-me-peace-firebase-adminsdk.json")
firebase_admin.initialize_app(cred)
db = firestore.client()

api_key = os.getenv("GEMINI_API_KEY")
client = genai.Client(api_key=api_key)


# ---------------------------
# ESP discovery + sync
# ---------------------------
def get_local_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    finally:
        s.close()


def to_num(x):
    if isinstance(x, bool):
        return 1.0 if x else 0.0
    if x is None:
        return 0.0
    try:
        return float(x)
    except Exception:
        return 0.0


def build_sensor_array(d: dict) -> list[float]:
    # Stable order for frontend indexing:
    # 0 tempC
    # 1 humidity
    # 2 sound peakToPeak
    # 3 ldr raw
    # 4 ldr volts
    # 5 sgp30 present (0/1)
    # 6 sgp30 eco2
    # 7 sgp30 tvoc
    # 8 rssi
    # 9 alarm (0/1)
    # 10 buzzerForced (0/1)
    # 11 led r
    # 12 led g
    # 13 led b

    dht = d.get("dht") or {}
    ldr = d.get("ldr") or {}
    sgp30 = d.get("sgp30") or {}
    sound = d.get("sound") or {}
    led = d.get("led") or {}

    return [
        to_num(dht.get("tempC")),
        to_num(dht.get("hum")),
        to_num(sound.get("peakToPeak")),
        to_num(ldr.get("raw")),
        to_num(ldr.get("volts")),
        to_num(sgp30.get("present")),
        to_num(sgp30.get("eco2")),
        to_num(sgp30.get("tvoc")),
        to_num(d.get("rssi")),
        to_num(d.get("alarm")),
        to_num(d.get("buzzerForced")),
        to_num(led.get("r")),
        to_num(led.get("g")),
        to_num(led.get("b")),
    ]


def probe_esp32(ip: str, timeout=0.35):
    try:
        r = requests.get(f"http://{ip}/api/sensors", timeout=timeout)
        if r.ok:
            return {"ip": ip, "data": r.json()}
    except requests.RequestException:
        return None


def upsert_device(ip: str, payload: dict):
    sensor_arr = build_sensor_array(payload)

    q = db.collection("data").where("ip", "==", ip).limit(1).stream()
    existing = next(q, None)

    if existing is None:
        doc = {
            "feedback": "",
            "ip": ip,
            "loc": {"lat": 0, "lng": 0},
            "rating": 0,
            "sensorData": sensor_arr,
            "led": False,
            "created": firestore.SERVER_TIMESTAMP,
            "lastSeen": firestore.SERVER_TIMESTAMP,
        }
        db.collection("data").add(doc)
    else:
        db.collection("data").document(existing.id).update(
            {
                "sensorData": sensor_arr,
                "lastSeen": firestore.SERVER_TIMESTAMP,
            }
        )


def discover_and_sync_once():
    local_ip = get_local_ip()
    subnet = ipaddress.ip_network(f"{local_ip}/24", strict=False)

    found = []
    with ThreadPoolExecutor(max_workers=60) as ex:
        futures = [ex.submit(probe_esp32, str(host)) for host in subnet.hosts()]
        for f in as_completed(futures):
            hit = f.result()
            if hit:
                found.append(hit)

    found_ips = {item["ip"] for item in found}

    # upsert all found devices
    for item in found:
        upsert_device(item["ip"], item["data"])

    # prune devices that disappeared
    docs = db.collection("data").stream()
    deleted = 0
    for doc in docs:
        d = doc.to_dict()
        ip = d.get("ip")
        if ip and ip not in found_ips:
            db.collection("data").document(doc.id).delete()
            deleted += 1

    print(f"[sync] {len(found)} device(s) synced, {deleted} removed")


def start_discovery_loop():
    def loop():
        while True:
            try:
                discover_and_sync_once()
            except Exception as e:
                print("[sync] error:", e)
            time.sleep(5)

    threading.Thread(target=loop, daemon=True).start()


# ---------------------------
# API routes
# ---------------------------


@app.route("/api", methods=["GET"])
def health():
    return jsonify({"ok": True}), 200


@app.route("/api/devices", methods=["GET"])
def get_devices():
    docs = db.collection("data").stream()
    devices = []
    for doc in docs:
        d = doc.to_dict()
        d["id"] = doc.id
        devices.append(d)
    return jsonify(devices), 200


@app.route("/api/devices/<device_id>/location", methods=["PUT"])
def set_location(device_id):
    data = request.json or {}
    loc = data.get("loc") or {}
    lat = loc.get("lat")
    lng = loc.get("lng")

    if lat is None or lng is None:
        return jsonify({"error": "Expected body: { loc: { lat, lng } }"}), 400

    db.collection("data").document(device_id).update({"loc": {"lat": lat, "lng": lng}})
    return jsonify({"ok": True}), 200


@app.route("/api/devices/<device_id>/sensorData", methods=["GET"])
def get_sensor_data(device_id):
    doc = db.collection("data").document(device_id).get()
    if not doc.exists:
        return jsonify({"error": "Device not found"}), 404
    d = doc.to_dict()
    return jsonify({"sensorData": d.get("sensorData", [])}), 200


@app.route("/api/devices/<device_id>/led", methods=["PUT"])
def set_led(device_id):
    data = request.json or {}
    led = data.get("led")
    if not isinstance(led, bool):
        return jsonify({"error": "Expected body: { led: true|false }"}), 400

    doc = db.collection("data").document(device_id).get()
    if not doc.exists:
        return jsonify({"error": "Device not found"}), 404

    device = doc.to_dict()
    ip = device.get("ip")
    if not ip:
        return jsonify({"error": "Device has no ip"}), 400

    # 1) update Firestore
    db.collection("data").document(device_id).update({"led": led})

    # 2) send command to ESP32
    try:
        r = requests.put(f"http://{ip}/api/led", json={"led": led}, timeout=0.6)
        if not r.ok:
            return jsonify({"error": "ESP32 rejected LED update"}), 502
    except requests.RequestException:
        return jsonify({"error": "Failed to reach ESP32"}), 502

    return jsonify({"ok": True}), 200


@app.route("/api/chat", methods=["POST"])
def chat():
    data = request.json or {}
    user_input = data.get("user_input")
    if not user_input:
        return jsonify({"error": "Expected body: { user_input: string }"}), 400

    docs = db.collection("data").stream()
    devices = []
    for doc in docs:
        d = doc.to_dict()
        devices.append(
            {
                "ip": d.get("ip"),
                "loc": d.get("loc"),
                "sensorData": d.get("sensorData"),
                "lastSeen": str(d.get("lastSeen")),
            }
        )

    prompt = (
        "You are a campus study-spot assistant. "
        "Use the device list to infer quiet/comfortable areas. "
        "Lower sound is quieter, lower TVOC/eCO2 is fresher air. "
        "Answer the user's query based on the device data.\n\n"
        f"Devices: {devices}\n\n"
        f"User: {user_input}"
    )

    resp = client.models.generate_content(model="gemini-1.5-flash", contents=prompt)
    return jsonify({"response": resp.text}), 200


# ---------------------------
# Run
# ---------------------------
if __name__ == "__main__":
    start_discovery_loop()
    app.run(debug=True, port=5000)
