from cvzone.HandTrackingModule import HandDetector
import cv2
import socket

# -------- CAMERA SETUP --------
cap = cv2.VideoCapture(1, cv2.CAP_DSHOW)  # Change index if needed
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

detector = HandDetector(detectionCon=0.8, maxHands=2)

# -------- SOCKET SETUP --------
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
serverAddressPort = ("127.0.0.1", 5052)

while True:
    success, img = cap.read()
    if not success:
        print("Camera not detected")
        break

    h, w, _ = img.shape
    hands, img = detector.findHands(img)
    gesture = ""

    if hands:
        hand = hands[0]  # First detected hand
        lmList = hand["lmList"]

        # -------- Send landmarks to Unity --------
        data = []
        for lm in lmList:
            x, y, z = lm
            data.extend([x, h - y, z])

        landmark_data = ','.join([str(int(val)) for val in data])

        # -------- Gesture Detection (Auto Left/Right Support) --------
        fingers = detector.fingersUp(hand)

        if fingers == [0, 0, 0, 0, 0]:
            gesture = "Fist"
        elif fingers == [1, 1, 1, 1, 1]:
            gesture = "Open Hand"
        elif fingers == [1, 0, 0, 0, 0]:
            gesture = "Thumbs Up"
        elif fingers == [0, 1, 1, 0, 0]:
            gesture = "Peace"
        elif fingers == [0, 1, 0, 0, 0]:
            gesture = "Pointing"
        else:
            gesture = "Unknown"

        # -------- Send Landmarks + Gesture --------
        message = landmark_data + "|" + gesture
        sock.sendto(message.encode('utf-8'), serverAddressPort)

        # -------- Draw Gesture --------
        cv2.putText(img, f'Gesture: {gesture}', (50, 100),
                    cv2.FONT_HERSHEY_SIMPLEX, 2, (0, 255, 0), 3)

    cv2.imshow("Hand Tracking", img)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

# -------- CLEANUP --------
cap.release()
cv2.destroyAllWindows()
sock.close()