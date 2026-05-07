---
illustration_id: 01
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
        Coral Red (#E8655A) sparingly for emphasis on fault 3 only.
Color values (#hex) and color names are rendering guidance only — do NOT display color names, hex codes, or palette labels as visible text in the image.

TITLE (TOP): Bold hand-lettered title: "分页四故障 — 从基础到本质"

LAYOUT: 4-zone ascending staircase / stacked-card layout, each zone slightly offset to the right to show progression.

ZONE 1 (Light Blue block, bottom-left, smallest):
  Label: "故障1：无 ORDER BY"
  Content: SQL snippet "LIMIT 0,10" without ORDER BY
  Small icons: database + question mark, dice (uncertainty)
  Tagline: "语义不稳定，每次结果可能不同"

ZONE 2 (Lavender block, second step):
  Label: "故障2：仅 created_at 排序"
  Content: "ORDER BY created_at DESC" with 3 records having same timestamp
  Small icons: clock with duplicate marks
  Tagline: "同值区间重排，重复或漏读"

ZONE 3 (Peach block, third step, Coral Red border highlight):
  Label: "故障3：offset + 并发写入"
  Content: Small diagram: query page 1 → 5 new rows inserted → query page 2 → duplicate rows (Coral Red "重复区")
  Small icons: database cylinder with arrow + warning sign
  Tagline: "重复发券！财产损失" (in Coral Red)

ZONE 4 (Mint Green block, top-right):
  Label: "故障4：社交 feed 翻页重复"
  Content: User browsing feed, new post pushes window → same post appears on page 2
  Small icons: phone/feed with overlapping card
  Tagline: "体验问题 → 正确性问题"

Hand-drawn ascending arrows connecting Zone 1 → 2 → 3 → 4 with label "递进升级"

BOTTOM: One short hand-lettered takeaway: "故障 1-2 是排序基础，故障 3-4 是锚点漂移"

ELEMENTS: Rounded info boxes stacked in staircase, wavy hand-drawn arrows, simple doodle icons (database, clock, phone, warning sign), small stars for emphasis on Zone 3.
STYLE: Minimal, airy, hand-lettered. Color fills do not completely fill outlines (hand-painted overshoot). ALL text hand-lettered, short keywords only, generous white space.
ASPECT: 16:9

Clean composition with generous white space. Simple warm cream background. Staircase ascending from bottom-left to top-right.
Text should be large and prominent with handwritten-style fonts. Keep minimal, focus on keywords.
