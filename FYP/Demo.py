import cv2
import mediapipe as mp

mp_hands = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils

hands = mp_hands.Hands(min_detection_confidence=0.7,
                       min_tracking_confidence=0.7)

cap = cv2.VideoCapture(0)

def count_fingers(hand_landmarks):
    finger_tips = [8, 12, 16, 20]  # Index, Middle, Ring, Pinky
    thumb_tip = 4

    fingers = []

    # Thumb
    if hand_landmarks.landmark[thumb_tip].x < hand_landmarks.landmark[thumb_tip - 2].x:
        fingers.append(1)
    else:
        fingers.append(0)

    # Other fingers
    for tip in finger_tips:
        if hand_landmarks.landmark[tip].y < hand_landmarks.landmark[tip - 2].y:
            fingers.append(1)
        else:
            fingers.append(0)

    return fingers.count(1)

while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break

    frame = cv2.flip(frame, 1)
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    result = hands.process(rgb)

    if result.multi_hand_landmarks:
        for hand_landmarks in result.multi_hand_landmarks:
            mp_drawing.draw_landmarks(frame, hand_landmarks, mp_hands.HAND_CONNECTIONS)

            total_fingers = count_fingers(hand_landmarks)

            cv2.putText(frame, f'Fingers: {total_fingers}',
                        (10, 70),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        2,
                        (0, 255, 0),
                        3)

    cv2.imshow("Hand Movement Detection", frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()
