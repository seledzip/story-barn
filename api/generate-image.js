// Vercel Serverless Function (Node.js runtime)
// Replicate의 Flux 모델로 장면 이미지를 생성합니다.
// REPLICATE_API_TOKEN 환경변수가 Vercel 프로젝트 설정에 등록되어 있어야 합니다.
// 로컬 HTML 파일(그림책방.html)에서 호출하므로 CORS를 열어둡니다.

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST 요청만 허용됩니다." });
    return;
  }

  const apiToken = process.env.REPLICATE_API_TOKEN;
  if (!apiToken) {
    res.status(500).json({ error: "서버에 REPLICATE_API_TOKEN 환경변수가 설정되지 않았습니다." });
    return;
  }

  const { prompt } = req.body || {};
  if (!prompt || !String(prompt).trim()) {
    res.status(400).json({ error: "prompt가 비어 있습니다." });
    return;
  }

  const fullPrompt = `${prompt}. Warm cinematic photo, soft natural lighting, realistic photography style, Korean everyday life, no text, no watermark, no logo.`;

  try {
    const predictionRes = await fetch(
      "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
          Prefer: "wait",
        },
        body: JSON.stringify({
          input: {
            prompt: fullPrompt,
            aspect_ratio: "16:9",
            output_format: "jpg",
          },
        }),
      }
    );

    const prediction = await predictionRes.json();

    if (!predictionRes.ok) {
      res.status(predictionRes.status).json({ error: prediction.detail || "Replicate API 오류" });
      return;
    }

    let outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    if (!outputUrl) {
      res.status(504).json({ error: "이미지 생성이 시간 내에 끝나지 않았습니다. 다시 시도해주세요." });
      return;
    }

    // 이미지를 서버에서 대신 받아 base64로 변환 (브라우저 캔버스에서 안전하게 쓰기 위함)
    const imgRes = await fetch(outputUrl);
    const arrayBuffer = await imgRes.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const contentType = imgRes.headers.get("content-type") || "image/jpeg";

    res.status(200).json({ imageDataUrl: `data:${contentType};base64,${base64}` });
  } catch (e) {
    res.status(500).json({ error: e.message || "알 수 없는 오류가 발생했습니다." });
  }
};
