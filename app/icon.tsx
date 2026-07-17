import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#101b34",
          color: "#c8a24d",
          fontSize: 18,
          fontWeight: 700,
          fontFamily: "Georgia, serif",
          borderRadius: 7
        }}
      >
        J
      </div>
    ),
    { ...size }
  );
}
