import { ImageResponse } from "next/og";

export function GET() {
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
        <div style={{ fontSize: 92, fontWeight: 700, letterSpacing: -3 }}>GP</div>
        <div style={{ fontSize: 24, opacity: 0.85, marginTop: -4 }}>PYQ</div>
      </div>
    ),
    { width: 192, height: 192 }
  );
}
