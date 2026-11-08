import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS uses this for the Home Screen icon. It must be opaque and unrounded —
// iOS applies its own mask, and transparency renders as black.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#15616d",
          color: "#ffffff",
        }}
      >
        <div style={{ fontSize: 86, fontWeight: 700, letterSpacing: -3 }}>GP</div>
        <div style={{ fontSize: 22, opacity: 0.85, marginTop: -4 }}>PYQ</div>
      </div>
    ),
    size
  );
}
