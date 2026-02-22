export default interface Device {
    id: string; // Firestore doc id

    feedback: string;
    ip: string;

    loc: {
        lat: number;
        lng: number;
    };

    rating: number;

    sensorData: number[];
}
