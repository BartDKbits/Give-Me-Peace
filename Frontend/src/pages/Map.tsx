import {
    MapContainer,
    TileLayer,
    GeoJSON,
    CircleMarker,
    Popup,
    useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useState } from "react";
import type { LatLngBoundsExpression } from "leaflet";
import type { GeoJsonObject } from "geojson";
import type Device from "../device";

const bounds: LatLngBoundsExpression = [
    [42.38369, -72.53974],
    [42.39602, -72.51571],
];

function ClickPicker({
    enabled,
    onPick,
}: {
    enabled: boolean;
    onPick: (lat: number, lng: number) => void;
}) {
    useMapEvents({
        click(e) {
            if (!enabled) return;
            onPick(e.latlng.lat, e.latlng.lng);
        },
    });
    return null;
}

export default function Map({
    devices,
    selectedId,
    onSelectDevice,
    onPickLocation,
}: {
    devices: Device[];
    selectedId: string | null;
    onSelectDevice: (id: string) => void;
    onPickLocation: (lat: number, lng: number) => void;
}) {
    const [geoData, setGeoData] = useState<GeoJsonObject | null>(null);

    useEffect(() => {
        let alive = true;
        fetch("/csLab.geojson")
            .then((res) => res.json())
            .then((data) => alive && setGeoData(data as GeoJsonObject))
            .catch(console.error);
        return () => {
            alive = false;
        };
    }, []);

    const selected = useMemo(
        () => devices.find((d) => d.id === selectedId) ?? null,
        [devices, selectedId],
    );

    const enabled = !!selectedId;

    return (
        <div style={{ height: "100%", width: "100%" }}>
            <MapContainer
                bounds={bounds}
                maxBounds={bounds}
                maxBoundsViscosity={1.0}
                minZoom={10}
                maxZoom={19}
                style={{ height: "100%", width: "100%" }}
            >
                <TileLayer
                    url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution="&copy; OpenStreetMap"
                    maxNativeZoom={18}
                    maxZoom={19}
                />

                <ClickPicker
                    enabled={enabled}
                    onPick={(lat, lng) => onPickLocation(lat, lng)}
                />

                {geoData && <GeoJSON data={geoData} />}

                {/* existing device markers */}
                {devices
                    .filter((d) => {
                        const lat = d.loc?.lat ?? 0;
                        const lng = d.loc?.lng ?? 0;
                        return !(lat === 0 && lng === 0);
                    })
                    .map((d) => (
                        <CircleMarker
                            key={d.id}
                            center={[d.loc.lat, d.loc.lng]}
                            radius={d.id === selectedId ? 14 : 10}
                            pathOptions={{ fillOpacity: 0.9 }}
                            eventHandlers={{
                                click: () => onSelectDevice(d.id),
                            }}
                        >
                            <Popup>
                                <div style={{ minWidth: 180 }}>
                                    <div>
                                        <b>{d.ip}</b>
                                        {d.id === selectedId
                                            ? " (selected)"
                                            : ""}
                                    </div>
                                    <div>
                                        🌡 Temp: {d.sensorData?.[0] ?? "-"} °C
                                    </div>
                                    <div>
                                        💡 Light: {d.sensorData?.[4] ?? "-"} V
                                    </div>
                                    <div>
                                        🌬 CO2: {d.sensorData?.[6] ?? "-"}
                                    </div>
                                    <div>
                                        🔊 Sound: {d.sensorData?.[2] ?? "-"}
                                    </div>
                                </div>
                            </Popup>
                        </CircleMarker>
                    ))}

                {/* show selected device even if it is 0,0 (so user knows what they’re setting) */}
                {selected &&
                    selected.loc.lat === 0 &&
                    selected.loc.lng === 0 && (
                        <CircleMarker
                            center={[42.3895, -72.528]} // just a campus-ish default so it’s visible
                            radius={14}
                            pathOptions={{ fillOpacity: 0.4 }}
                        >
                            <Popup>
                                Select a spot on the map to set location for{" "}
                                <b>{selected.ip}</b>
                            </Popup>
                        </CircleMarker>
                    )}
            </MapContainer>
        </div>
    );
}
