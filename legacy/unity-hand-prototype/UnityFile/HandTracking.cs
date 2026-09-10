using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class HandTracking : MonoBehaviour
{
    public UDPReceive udpReceive;        // Receives data from Python
    public GameObject[] handPoints;      // 21 hand landmarks

    void Update()
    {
        string data = udpReceive.data;

        if (string.IsNullOrEmpty(data))
            return; // nothing received yet

        // Split string into numbers
        string[] points = data.Split(',');

        // Safety check: we need 21 points * 3 coords = 63 values
        if (points.Length < 63)
            return;

        // Update hand points positions
        for (int i = 0; i < 21; i++)
        {
            float x = 7 - float.Parse(points[i * 3].Trim()) / 100;
            float y = float.Parse(points[i * 3 + 1].Trim()) / 100;
            float z = float.Parse(points[i * 3 + 2].Trim()) / 100;

            handPoints[i].transform.localPosition = new Vector3(x, y, z);
        }

        // Detect gestures after updating positions
        DetectGesture();
    }

    // ------------------ Gesture Detection ------------------
    void DetectGesture()
    {
        float threshold = 0.008f; // tweak if gestures are not detected

        // Thumb (tip vs base)
        bool thumbOpen = Vector3.Distance(handPoints[4].transform.localPosition, handPoints[2].transform.localPosition) > threshold;

        // Fingers: index, middle, ring, pinky
        bool indexOpen = Vector3.Distance(handPoints[8].transform.localPosition, handPoints[6].transform.localPosition) > threshold;
        bool middleOpen = Vector3.Distance(handPoints[12].transform.localPosition, handPoints[10].transform.localPosition) > threshold;
        bool ringOpen = Vector3.Distance(handPoints[16].transform.localPosition, handPoints[14].transform.localPosition) > threshold;
        bool pinkyOpen = Vector3.Distance(handPoints[20].transform.localPosition, handPoints[18].transform.localPosition) > threshold;

        string gesture = "Unknown";

        if (!thumbOpen && !indexOpen && !middleOpen && !ringOpen && !pinkyOpen)
            gesture = "Fist";
        else if (thumbOpen && indexOpen && middleOpen && ringOpen && pinkyOpen)
            gesture = "Open Hand";
        else if (thumbOpen && !indexOpen && !middleOpen && !ringOpen && !pinkyOpen)
            gesture = "Thumbs Up";
        else if (!thumbOpen && indexOpen && middleOpen && !ringOpen && !pinkyOpen)
            gesture = "Peace";
        else if (!thumbOpen && indexOpen && !middleOpen && !ringOpen && !pinkyOpen)
            gesture = "Pointing";

        // Print detected gesture in console
        Debug.Log("Gesture: " + gesture);
    }
}
