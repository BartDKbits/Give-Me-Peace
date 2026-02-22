export default interface Device {
    id: string; // Firestore doc id
    ai_rating: number;
    ai_feedback: string;
    ip: string;

    loc: {
        lat: number;
        lng: number;
    };

    rating: number;
    feedback: string[];
    sensorData: number[];
}
