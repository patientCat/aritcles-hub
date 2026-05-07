---
illustration_id: 03
type: infographic
style: sketch-notes
palette: macaron
---

Single-page hand-drawn educational infographic in a clean presentation style.
Warm cream paper background (#F5F0E8), black hand-drawn lines with slight wobble, soft pastel color blocks.
Diagram-style visuals ONLY — no realistic or photographic images.

PALETTE: macaron — soft pastel blocks on warm cream
COLORS: Warm Cream background (#F5F0E8); Black (#1A1A1A) for ALL lines, text, arrows, and doodles;
        section fills in Light Blue (#A8D8EA), Mint Green (#B5E5CF), Lavender (#D5C6E0), Peach (#FFD5C2);
        Coral Red (#E8655A) sparingly for the HMAC/签名 emphasis only.
Color values (#hex) and color names are rendering guidance only — do NOT display color names, hex codes, or palette labels as visible text in the image.

TITLE (TOP): Bold hand-lettered title: "Cursor Token 设计"

LAYOUT (三区域 T 形):
- LEFT ZONE (Light Blue block): 
    Label: "Request 入参"
    Fields (hand-lettered list):
    • page_size: 20
    • cursor: "eyJ..." (首次为空)
    • filters: { coupon_batch_id }
    Small note: "排序由服务端固定"

- CENTER ZONE (Lavender block, slightly larger):
    Label: "Cursor Token 内部结构"
    Content diagram (box with fields):
    • created_at: "2026-05-07T15:10:00Z"
    • id: 987654321
    • filters_hash: "9f2a..."
    • exp: 1770000000
    Below box: hand-drawn arrow → "base64url 编码" → "HMAC 签名"
    Small doodle: lock icon next to HMAC

- RIGHT ZONE (Mint Green block):
    Label: "Response 出参"
    Fields (hand-lettered list):
    • items: [ ... ]
    • next_cursor: "eyJ..."
    • has_more: true
    Small note: "取最后一条 (created_at, id)"

- BOTTOM (Peach block, full-width):
    Label: "服务端消费 Cursor"
    SQL snippet (手绘等宽字体风格):
    WHERE (created_at < :t) OR (created_at = :t AND id < :id)
    ORDER BY created_at DESC, id DESC LIMIT :size
    Coral Red 小标注: "filters_hash 不一致 → cursor 失效"

Hand-drawn arrows: Request → Token → Response (左→中→右)，Token → SQL (中→下)

BOTTOM TAGLINE: One short hand-lettered takeaway: "接口契约稳定 = 锚点稳定"

ELEMENTS: Rounded info boxes, wavy hand-drawn arrows with inline labels, simple doodle icons (lock, checkmark, database, API symbol), small stars for emphasis.
STYLE: Minimal, airy. Color fills do not completely fill outlines. ALL text hand-lettered, keywords only, generous white space.
ASPECT: 16:9

Clean composition with generous white space. Simple warm cream background. 3-zone layout with clear connections.
Text should be large and prominent with handwritten-style fonts. Keep minimal, focus on keywords and actual field names.
