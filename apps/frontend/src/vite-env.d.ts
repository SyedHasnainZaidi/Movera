/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_POSE_WS_URL: string;
  readonly VITE_POSE_FRAME_SAMPLE_FPS: string;
  readonly VITE_POSE_IMAGE_WIDTH: string;
  readonly VITE_POSE_IMAGE_QUALITY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
