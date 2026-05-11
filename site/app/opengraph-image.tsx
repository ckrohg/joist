import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export const alt =
  "Joist — the open-source backbone for AI-edited Elementor sites.";

export default function OG() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0E0E0C",
          color: "#F3F2EC",
          padding: "72px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            fontSize: "28px",
            letterSpacing: "-0.02em",
          }}
        >
          <div
            style={{
              width: "32px",
              height: "8px",
              background: "#D4FF3A",
              borderRadius: "2px",
            }}
          />
          <span style={{ fontWeight: 500 }}>Joist</span>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "24px",
          }}
        >
          <div
            style={{
              fontSize: "72px",
              lineHeight: 1.04,
              letterSpacing: "-0.025em",
              fontWeight: 400,
              maxWidth: "950px",
              display: "flex",
              flexWrap: "wrap",
            }}
          >
            <span>The open-source backbone for&nbsp;</span>
            <span style={{ color: "#D4FF3A", fontStyle: "italic" }}>
              AI-edited Elementor
            </span>
            <span>&nbsp;sites.</span>
          </div>
          <div
            style={{
              fontSize: "24px",
              color: "#A6A39A",
              maxWidth: "900px",
              lineHeight: 1.4,
            }}
          >
            Safe · schema-validated · audit-logged · revertible · round-trip safe.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "18px",
            color: "#6B675F",
            letterSpacing: "0.08em",
          }}
        >
          <div>OPEN SOURCE · MIT + GPL · PRE-v0.1</div>
          <div>github.com/ckrohg/tenet-elementor</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
