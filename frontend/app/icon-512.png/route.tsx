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
        <div style={{ fontSize: 248, fontWeight: 700, letterSpacing: -8 }}>GP</div>
        <div style={{ fontSize: 64, opacity: 0.85, marginTop: -12 }}>PYQ</div>
      </div>
    ),
    { width: 512, height: 512 }
  );
}
