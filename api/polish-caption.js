// Vercel Serverless Function (Node.js runtime)
// 기획 메모 말투("~를 설명한다", "~를 보여준다")의 장면 설명을,
// 시청자에게 실제 정보를 전달하는 자막 문장으로 다듬어줍니다.
// ANTHROPIC_API_KEY 환경변수를 재사용합니다 (generate-script.js와 동일).

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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "서버에 ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다." });
    return;
  }

  const { text, topic } = req.body || {};
  if (!text || !String(text).trim()) {
    res.status(400).json({ error: "text가 비어 있습니다." });
    return;
  }

  const system = `당신은 대한민국 시니어(55~75세) 시청자를 위한 유튜브 영상의 자막 작가입니다. 입력으로 "기획 메모" 형태의 장면 설명(예: "~를 설명한다", "~를 보여준다", "~를 소개한다")이 주어지면, 이를 시청자가 실제로 화면에서 읽게 될 정보성 자막 문장으로 다시 씁니다.

규칙:
- "설명한다", "보여준다", "소개한다" 같은 3인칭 기획 말투를 없애고, 시청자에게 직접 정보를 전달하는 문장으로 바꾸세요.
- 이미 널리 알려져 있고 여러 매체에서 반복적으로 인용되는 사실(예: "스마트폰이 변기보다 세균이 많다는 애리조나대 연구")은 자연스럽게 포함해도 됩니다.
- 정확히 알지 못하는 구체적인 수치나 통계를 새로 지어내지 마세요. 확신이 없으면 "~로 알려져 있습니다", "~라는 연구 결과도 있습니다"처럼 단정적이지 않게 표현하세요.
- 따뜻하고 차분한 존댓말, 시니어가 편하게 읽을 수 있는 쉬운 문장으로 쓰세요.
- 2~3문장, 자막으로 화면에 띄우기 적당한 길이로 쓰세요.
- 출력은 다듬어진 자막 문장만 출력하세요. 설명, 따옴표, 마크다운을 포함하지 마세요.`;

  const userMsg = `${topic ? `영상 주제: ${topic}\n` : ""}장면 기획 메모: ${text}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 300,
        system,
        messages: [{ role: "user", content: userMsg }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      res.status(response.status).json({ error: data.error?.message || "Anthropic API 오류" });
      return;
    }

    const polished = (data.content || [])
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();

    if (!polished) {
      res.status(502).json({ error: "다듬어진 자막을 받지 못했습니다." });
      return;
    }

    res.status(200).json({ polishedText: polished });
  } catch (e) {
    res.status(500).json({ error: e.message || "알 수 없는 오류가 발생했습니다." });
  }
};
