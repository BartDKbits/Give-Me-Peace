import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "./DataView.module.css";
import type Device from "../device";
import Map from "./Map";

const DataView: React.FC<{ goHome: () => void }> = ({ goHome }) => {
    const [devices, setDevices] = useState<Device[]>([]);
    const [tab, setTab] = useState<"map" | "table">("map");

    // location edit state
    const [editingId, setEditingId] = useState<string | null>(null);
    const [draftLat, setDraftLat] = useState<string>("");
    const [draftLng, setDraftLng] = useState<string>("");
    const [selectedId, setSelectedId] = useState<string | null>(null);

    // toggle sensor preview when clicking location
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const editorRef = useRef<HTMLDivElement | null>(null);

    const fetchDevices = useMemo(
        () => () => {
            fetch("http://127.0.0.1:5000/api/devices")
                .then((res) => res.json())
                .then((json) => setDevices(json))
                .catch((err) => console.error("Fetch error:", err));
        },
        [],
    );

    useEffect(() => {
        fetchDevices();
        const interval = setInterval(fetchDevices, 5000);
        return () => clearInterval(interval);
    }, [fetchDevices]);

    const saveLocation = async (deviceId: string, lat: number, lng: number) => {
        // optimistic update so UI feels instant
        setDevices((prev) =>
            prev.map((d) =>
                d.id === deviceId ? { ...d, loc: { lat, lng } } : d,
            ),
        );

        const res = await fetch(
            `http://127.0.0.1:5000/api/devices/${deviceId}/location`,
            {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ loc: { lat, lng } }),
            },
        );

        if (!res.ok) {
            console.error("Failed to save location");
            fetchDevices(); // rollback by refetching
        }
    };

    // click anywhere else to save + exit edit mode
    useEffect(() => {
        const onMouseDown = (e: MouseEvent) => {
            if (!editingId) return;
            if (!editorRef.current) return;

            const target = e.target as Node;
            if (editorRef.current.contains(target)) return;

            const lat = Number(draftLat);
            const lng = Number(draftLng);

            setEditingId(null);

            if (Number.isFinite(lat) && Number.isFinite(lng)) {
                saveLocation(editingId, lat, lng);
            }
        };

        document.addEventListener("mousedown", onMouseDown);
        return () => document.removeEventListener("mousedown", onMouseDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editingId, draftLat, draftLng]);

    const startEditing = (device: Device) => {
        setEditingId(device.id);
        setDraftLat(String(device.loc?.lat ?? 0));
        setDraftLng(String(device.loc?.lng ?? 0));
    };

    const toggleExpanded = (deviceId: string) => {
        setExpandedId((prev) => (prev === deviceId ? null : deviceId));
    };

    return (
        <div className={styles.container}>
            <div className={styles.topBar}>
                <button onClick={goHome} className={styles.back}>
                    ←
                </button>

                <div className={styles.tabBar}>
                    <button
                        className={`${styles.tabBtn} ${
                            tab === "map" ? styles.active : ""
                        }`}
                        onClick={() => setTab("map")}
                    >
                        Map
                    </button>

                    <button
                        className={`${styles.tabBtn} ${
                            tab === "table" ? styles.active : ""
                        }`}
                        onClick={() => setTab("table")}
                    >
                        Cards
                    </button>
                </div>
            </div>

            <div className={styles.content}>
                {tab === "map" ? (
                    <div className={styles.mapWrap}>
                        <div style={{ padding: 10, background: "#f5f5f5" }}>
                            <span style={{ marginRight: 10 }}>
                                Pick device:
                            </span>
                            <select
                                value={selectedId ?? ""}
                                onChange={(e) =>
                                    setSelectedId(e.target.value || null)
                                }
                            >
                                <option value="">(select)</option>
                                {devices.map((d) => (
                                    <option key={d.id} value={d.id}>
                                        {d.ip}
                                    </option>
                                ))}
                            </select>
                            <span style={{ marginLeft: 10, opacity: 0.7 }}>
                                Then click map to set location
                            </span>
                        </div>
                        <Map
                            devices={devices}
                            selectedId={selectedId}
                            onSelectDevice={(id) => setSelectedId(id)}
                            onPickLocation={async (lat, lng) => {
                                if (!selectedId) return;

                                // optimistic update
                                setDevices((prev) =>
                                    prev.map((d) =>
                                        d.id === selectedId
                                            ? { ...d, loc: { lat, lng } }
                                            : d,
                                    ),
                                );

                                // save to Flask
                                await fetch(
                                    `http://127.0.0.1:5000/api/devices/${selectedId}/location`,
                                    {
                                        method: "PUT",
                                        headers: {
                                            "Content-Type": "application/json",
                                        },
                                        body: JSON.stringify({
                                            loc: { lat, lng },
                                        }),
                                    },
                                );
                            }}
                        />
                    </div>
                ) : (
                    <div className={styles.grid}>
                        {devices.map((device) => {
                            const isEditing = editingId === device.id;
                            const isExpanded = expandedId === device.id;

                            const temp = device.sensorData?.[0];
                            const hum = device.sensorData?.[1];
                            const sound = device.sensorData?.[2];
                            const lightVolts = device.sensorData?.[4];
                            const eco2 = device.sensorData?.[6];

                            return (
                                <div key={device.id} className={styles.card}>
                                    <div className={styles.cardHeader}>
                                        <h2 className={styles.cardTitle}>
                                            {device.ip}
                                        </h2>

                                        <button
                                            className={styles.buzzerBtn}
                                            onMouseDown={() =>
                                                fetch(
                                                    `http://${device.ip}/api/buzzer?on=1`,
                                                )
                                            }
                                            onMouseUp={() =>
                                                fetch(
                                                    `http://${device.ip}/api/buzzer?on=0`,
                                                )
                                            }
                                            onMouseLeave={() =>
                                                fetch(
                                                    `http://${device.ip}/api/buzzer?on=0`,
                                                )
                                            }
                                        >
                                            🔔
                                        </button>

                                        <div
                                            className={styles.locRow}
                                            onClick={() =>
                                                toggleExpanded(device.id)
                                            }
                                            role="button"
                                            tabIndex={0}
                                        >
                                            <span className={styles.cardSub}>
                                                Location: {device.loc?.lat ?? 0}
                                                , {device.loc?.lng ?? 0}
                                            </span>

                                            <button
                                                className={styles.editBtn}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    startEditing(device);
                                                }}
                                                title="Edit location"
                                            >
                                                ✏️
                                            </button>
                                        </div>

                                        {isEditing && (
                                            <div
                                                ref={editorRef}
                                                className={styles.locEditor}
                                                onClick={(e) =>
                                                    e.stopPropagation()
                                                }
                                            >
                                                <div
                                                    className={styles.locField}
                                                >
                                                    <label>Lat</label>
                                                    <input
                                                        value={draftLat}
                                                        onChange={(e) =>
                                                            setDraftLat(
                                                                e.target.value,
                                                            )
                                                        }
                                                        inputMode="decimal"
                                                    />
                                                </div>
                                                <div
                                                    className={styles.locField}
                                                >
                                                    <label>Lng</label>
                                                    <input
                                                        value={draftLng}
                                                        onChange={(e) =>
                                                            setDraftLng(
                                                                e.target.value,
                                                            )
                                                        }
                                                        inputMode="decimal"
                                                    />
                                                </div>
                                                <div className={styles.locHint}>
                                                    Click anywhere outside to
                                                    save
                                                </div>
                                            </div>
                                        )}

                                        {isExpanded && (
                                            <div className={styles.sensorMini}>
                                                <div>
                                                    🌡 Temp:{" "}
                                                    <b>{temp ?? "-"}</b> °C
                                                </div>
                                                <div>
                                                    💡 Light:{" "}
                                                    <b>{lightVolts ?? "-"}</b> V
                                                </div>
                                                <div>
                                                    🌬 CO2: <b>{eco2 ?? "-"}</b>
                                                </div>
                                                <div>
                                                    🔊 Sound:{" "}
                                                    <b>{sound ?? "-"}</b>
                                                </div>
                                                <div
                                                    className={
                                                        styles.sensorMiniSub
                                                    }
                                                >
                                                    (Humidity: {hum ?? "-"}%)
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div className={styles.section}>
                                        <h4 className={styles.sectionTitle}>
                                            Environment
                                        </h4>

                                        <div className={styles.row}>
                                            <span className={styles.label}>
                                                🌡 Temp (°C)
                                            </span>
                                            <span className={styles.value}>
                                                {device.sensorData?.[0] ?? "-"}
                                            </span>
                                        </div>

                                        <div className={styles.row}>
                                            <span className={styles.label}>
                                                💧 Humidity (%)
                                            </span>
                                            <span className={styles.value}>
                                                {device.sensorData?.[1] ?? "-"}
                                            </span>
                                        </div>

                                        <div className={styles.row}>
                                            <span className={styles.label}>
                                                🔊 Sound
                                            </span>
                                            <span className={styles.value}>
                                                {device.sensorData?.[2] ?? "-"}
                                            </span>
                                        </div>

                                        <div className={styles.row}>
                                            <span className={styles.label}>
                                                💡 LDR Raw
                                            </span>
                                            <span className={styles.value}>
                                                {device.sensorData?.[3] ?? "-"}
                                            </span>
                                        </div>

                                        <div className={styles.row}>
                                            <span className={styles.label}>
                                                💡 LDR Volts
                                            </span>
                                            <span className={styles.value}>
                                                {device.sensorData?.[4] ?? "-"}
                                            </span>
                                        </div>
                                    </div>

                                    <div className={styles.section}>
                                        <h4 className={styles.sectionTitle}>
                                            Air Quality
                                        </h4>

                                        <div className={styles.row}>
                                            <span className={styles.label}>
                                                🌬 SGP30 Present
                                            </span>
                                            <span className={styles.value}>
                                                {device.sensorData?.[5]
                                                    ? "Yes"
                                                    : "No"}
                                            </span>
                                        </div>

                                        <div className={styles.row}>
                                            <span className={styles.label}>
                                                🫧 eCO2
                                            </span>
                                            <span className={styles.value}>
                                                {device.sensorData?.[6] ?? "-"}
                                            </span>
                                        </div>

                                        <div className={styles.row}>
                                            <span className={styles.label}>
                                                🌫 TVOC
                                            </span>
                                            <span className={styles.value}>
                                                {device.sensorData?.[7] ?? "-"}
                                            </span>
                                        </div>

                                        <div className={styles.row}>
                                            <span className={styles.label}>
                                                📶 RSSI
                                            </span>
                                            <span className={styles.value}>
                                                {device.sensorData?.[8] ?? "-"}
                                            </span>
                                        </div>
                                    </div>

                                    <div className={styles.section}>
                                        <h4 className={styles.sectionTitle}>
                                            Status
                                        </h4>

                                        <div className={styles.row}>
                                            <span className={styles.label}>
                                                🚨 Alarm
                                            </span>
                                            <span className={styles.value}>
                                                {device.sensorData?.[9]
                                                    ? "Yes"
                                                    : "No"}
                                            </span>
                                        </div>

                                        <div className={styles.row}>
                                            <span className={styles.label}>
                                                🔔 Buzzer Forced
                                            </span>
                                            <span className={styles.value}>
                                                {device.sensorData?.[10]
                                                    ? "Yes"
                                                    : "No"}
                                            </span>
                                        </div>

                                        <div className={styles.row}>
                                            <span className={styles.label}>
                                                🎨 LED (R,G,B)
                                            </span>
                                            <span className={styles.value}>
                                                {device.sensorData?.[11] ?? 0},{" "}
                                                {device.sensorData?.[12] ?? 0},{" "}
                                                {device.sensorData?.[13] ?? 0}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default DataView;
