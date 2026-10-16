// LLM article generator + filesystem cache for WikiSearchle.
//
// Two surfaces:
//   - getCachedArticle(slug) [sync]
//       Reads data/generated-articles/<slug>.txt. No SDK, no network.
//       Used by server.js at round-build time. Returns null on miss.
//
//   - generateAndCache(entry, opts) [async]
//       Fetches the Wikipedia lead, calls Claude Haiku with the v3 prompt
//       and prompt-caching enabled, validates the output, retries once on
//       hard-rule failure with feedback, writes to cache. Used by the
//       offline batch script. Lazily requires @anthropic-ai/sdk so the
//       runtime side never tries to load the SDK.
//
// Cache layout under <cacheDir> (default: data/generated-articles):
//   <slug>.txt              successful article body (4 paragraphs)
//   <slug>.flags.json       soft warnings (only present if non-empty)
//   _failed.json            registry of slugs where both attempts failed

const fs = require('fs');
const path = require('path');
const validator = require('./article-validator');

const DEFAULT_CACHE_DIR = path.join(__dirname, '..', 'data', 'generated-articles');
// Default to Sonnet 4.6: this account's prompt cache works on Sonnet but
// is silently disabled on Haiku 4.5. With caching, padded-prompt Sonnet
// runs ~$64 for the 10K batch — comparable to padded-prompt Haiku with
// no cache, but with materially higher quality on hard multi-word titles.
const DEFAULT_MODEL = process.env.WIKISEARCHLE_GEN_MODEL || 'claude-sonnet-4-6';

// Prompt version selection. v3 was locked 2026-05-03 on a mixed pool
// that included proper nouns and polysemous-word titles. v4 (default
// 2026-05-13) is tuned for the easy-tier filter shipped in
// chat-relay@cf4f4b4 + wikisearchle@c3560d6 — titles are now always
// common nouns or adjective-noun pairs. v4 keeps every v3 rule, drops
// the four off-pool examples (First Crusade, Storming, Gupta, Plant
// milk) and Anubis (single-word proper noun, edge-case in pool), adds
// three new examples (Octopus, Coffee bean, Espresso martini), and
// introduces a "semantic density" rule so player guesses against the
// common-noun title rank-target produce more reveals. Override the
// active version with WIKISEARCHLE_PROMPT_VERSION=v3 (or any future
// version). Both prompts kept intact so we can A/B / roll back fast.
const PROMPT_VERSION = process.env.WIKISEARCHLE_PROMPT_VERSION || 'v4';

// v3 system prompt (locked after the Bread/Renaissance/Star Wars/Minecraft/
// Moon Landing/Civil Rights Movement test pass on 2026-05-03). Static —
// fully cacheable via Anthropic prompt caching.
const SYSTEM_PROMPT_V3 = `You write short encyclopedia-style articles for a word-guessing game. Players reveal the article one word at a time and try to guess its title. Your job is to write text that lets a player infer the subject from CONTEXT — not from finding the title spelled out in the lead.

## Hard rules

1. **Length**: Exactly 4 paragraphs, separated by one blank line. Each paragraph is 3–4 sentences, 30–50 words. Total 130–180 words.

2. **Title-word placement**:
   - Every title word (given in the user message) must appear in the body in the EXACT form listed, matched as a whole word. Other inflections do NOT count: if the listed word is "war", the article must contain the literal token "war" (not "wars", "warfare", "warring", "postwar"). If the listed word is "wars", the article must contain "wars" (not "war").
   - Title words appear in paragraphs 2, 3, or 4. NEVER in paragraph 1, even as common English words. If you would naturally reach for one ("room", "make", "fire", "war", "star"), restructure.

3. **No title spoilers**:
   - For MULTI-WORD titles: the full title must never appear verbatim, AND title words must never appear consecutively in their natural title order. Even if each word independently satisfies rule 2, the phrase "moon landing" (the title) cannot appear. Place title words in DIFFERENT sentences so the title cannot be reassembled by reading word-adjacent text. For "civil rights movement", the bigrams "civil rights" and "rights movement" must also not appear.
   - For SINGLE-WORD titles: rule 2 still applies — the title word must appear in paragraphs 2-4. Use it naturally as part of a normal sentence; do NOT preface it with "the title", "this game", "this concept", or any phrase that meta-references the puzzle. Just write "Bread is...", "Minecraft launched...", etc.
   - Do not hint at the title via metaphor — describing a non-war as "cold", a non-fire as "fiery", a non-old thing as "ancient" telegraphs the title. Players pattern-match those.

4. **Paragraph 1 framing**: Set context indirectly. Use phrases like "this discipline", "the figure", "the work", and surrounding facts (era, region, field, medium) that let an attentive reader narrow the subject down without seeing its name.

5. **Grounding**: Use only facts from the reference material in the user message. Do not invent dates, names, places, or relationships. Every specific number, year, date, name, and place in your output must appear identically in the reference. Before finalizing each sentence, verify each concrete detail in it against the reference; if you cannot find it there, replace it with a vaguer reference or omit the detail.

6. **No quoting or voice imitation**: Do not reuse any 6-or-more-word phrase from the reference. Do not adopt its voice, sentence shape, or rhetorical structure. Extract facts; write in your own voice.

7. **Vocabulary**: Use ordinary English. Avoid rare technical jargon, obscure proper nouns, and made-up terms.

8. **Concrete details**: Prefer specific dates, place names, and numbers over vague references.

## Style

- Vary how paragraphs open: a date, a comparison, a contrast, a consequence, a description, a question. Do not start two paragraphs the same way in one article.
- Avoid stock encyclopedia openers ("X is a Y", "X was a Y founded in Z"). Players pattern-match those instantly.
- Prefer specific verbs ("forged", "displaced", "succeeded") over generic ones ("made", "moved", "did").

## Safety

If the topic involves violence, abuse, sexual content, or controversial figures, stay clinical and factual. No graphic detail. If the reference contains slurs or content unsuitable for a public stream, output the literal single word \`UNSAFE\` and nothing else.

## Output

Output only the four paragraphs as plain text, separated by one blank line. No title, no headers, no markdown, no preamble, no sign-off. Begin directly with the first sentence of paragraph 1.

## Examples

The following are reference outputs for four articles. Each demonstrates the format (4 paragraphs, plain text, blank-line separated) and the rules in action: title words absent from paragraph 1, distributed across paragraphs 2-4 in their EXACT form, no adjacent title bigrams, no metaphor hints, varied paragraph openings, concrete grounded details. Study these but do NOT reuse their phrasings or sentence patterns when writing new articles.

### Example 1 — Title: Bread (single-word)
Title norms: bread

For millennia, societies across Europe and the Middle East have relied on a foundational staple. This food emerged alongside agriculture itself, becoming woven into religious ceremonies and everyday sustenance alike. Its significance spans from ancient times to the present day.

The basic formula remains simple: water, flour, and often yeast combine through baking. Leavening transforms the mixture—whether through natural fermentation, chemical agents, baking soda, or industrial yeast—creating air pockets that lighten the final product. Modern manufacturers frequently add preservatives and flavor enhancers to extend shelf life and improve texture.

Unleavened varieties exist in many cuisines, offering a denser alternative. When bread reaches commercial scale, additives serve multiple purposes: they boost nutrition, enhance color, and streamline production. This approach has made the item affordable and accessible worldwide.

Linguistically, the word traces back to Germanic roots around 1200 in English usage. Originally it referred to a bit, crumb, or morsel—a fragment rather than a whole loaf. The Old English terms brēotan and brēad carried this meaning before the modern sense solidified.

### Example 2 — Title: First Crusade (multi-word; norms must not be adjacent)
Title norms: first, crusade

The legacy of this military campaign shaped Christian-Muslim relations for centuries. Thousands of armed pilgrims traveled eastward, fundamentally altering the geopolitical landscape of the Mediterranean and Near East. The expedition's success established a template for religious warfare that would echo through subsequent centuries. Its consequences rippled across continents and generations.

In 1095, a Byzantine emperor faced mounting pressure from Turkish forces encroaching on his realm. He dispatched ambassadors to seek military aid from the Latin West, setting in motion the first of many such campaigns. This initial appeal would transform into something far larger than a simple military alliance.

That same year, a major church council convened in central Europe to address the crisis. The Pope delivered a stirring address that reframed the conflict as a sacred duty. His call to undertake an armed pilgrimage resonated with both nobility and common folk, inspiring the crusade that would define an era.

For nearly four years, waves of warriors and pilgrims journeyed toward Jerusalem, driven by religious conviction and earthly ambition. The campaign succeeded in wresting the Holy Land from Muslim control, though the human cost was staggering. This feat demonstrated the Church's power to mobilize Christendom and established a precedent that would spawn generations of religious conflict.

### Example 3 — Title: Anubis (single-word, proper noun)
Title norms: anubis

During the First Dynasty, around 3100 BC, a figure emerged in the Egyptian pantheon whose influence would persist for millennia. This deity embodied the mysteries of death and the passage beyond life, serving roles that shifted across different historical periods. The figure's iconography—part human, part animal—reflected the ancient world's attempts to visualize forces beyond the mortal realm.

In his earliest manifestations, anubis protected burial sites and oversaw the preservation of the dead. Priests performing embalming rituals invoked his presence, believing he sanctioned their work. His canine form suggested both the guardian's vigilance and the scavenger's connection to tombs scattered across the desert landscape.

By the Middle Kingdom, anubis relinquished his supremacy over the underworld to a rival deity, yet retained considerable authority. He remained the figure who guided souls through their final judgment, standing witness as hearts were weighed against truth. This ceremonial role made him indispensable to Egyptian concepts of the afterlife and moral accountability.

Few major myths elaborated his story, yet anubis appeared more frequently in temple inscriptions and funerary art than almost any other god. His presence reassured the living that their remains would be honored and their transition to the next world assured. This constancy across centuries reflects how deeply embedded he became in Egyptian religious consciousness.

### Example 4 — Title: Starburst galaxy (multi-word; science concept)
Title norms: starburst, galaxy

In the 1980s, astronomers began cataloging galaxies with unusual properties, noticing that some exhibited dramatically accelerated processes compared to their calmer neighbors. These objects challenged conventional models of how stellar systems evolve over cosmic time. The phenomenon revealed itself through intense emissions and visible disturbances in their structure.

A starburst occurs when a galaxy enters a phase of exceptionally rapid stellar birth. The Milky Way produces roughly 3 solar masses of new stars annually, yet these turbocharged systems can generate 100 times that rate or higher. Such prolific output reshapes the entire galaxy within just a hundred million years—a blink compared to its full lifetime.

Most galaxies undergoing this transformation are colliding or passing dangerously close to a neighbor. The gravitational disruption triggers a cascade of events that compresses vast reserves of gas and ignites wholesale star formation. Famous examples include M82, the Antennae Galaxies, and IC 10, each bearing the scars of cosmic violence.

The intensity proves unsustainable. While ordinary galaxies can sustain their star-making for billions of years, these explosive episodes burn through all available fuel in a fraction of that time. Once the molecular gas depletes, the frenzy subsides, and the galaxy settles into a quieter existence, leaving behind the evidence of its brief, violent awakening.

### Example 5 — Title: Storming of the Bastille (multi-word historical event; STOPLIST drops "of"/"the")
Title norms: storming, bastille

In the summer of 1789, Paris erupted into violence that would reshape European politics for generations. A single day's uprising became the defining moment of a nation's transformation. The event's consequences rippled across borders and centuries, cementing its place in history.

The storming began on 14 July when revolutionary crowds converged on a fortress in central Paris. After four hours of intense combat and 94 deaths, the insurgents breached its walls. The governor, Bernard-René Jourdan de Launay, was killed along with members of the garrison after they surrendered to the mob.

What made the bastille so symbolically potent? Though it held only seven prisoners at the time and faced scheduled demolition, it stood as the visible embodiment of royal tyranny. Revolutionaries saw its medieval stones as a monument to the monarchy's unchecked power over its subjects.

The fortress's fall ignited the French Revolution and became a turning point in European history. France now observes 14 July as a national holiday, commemorating both the uprising and the Fête de la Fédération held one year later. The date remains a global symbol of liberty and the people's capacity to challenge entrenched authority.

### Example 6 — Title: Gupta Empire (multi-word; civilization)
Title norms: gupta, empire

Many readers know of Rome's classical dominance across the Mediterranean, yet fewer recognize the simultaneous flourishing of a vast Indian civilization. While Western empires commanded attention in Greek and Latin texts, another power consolidated control across the Indian subcontinent during similar centuries. This eastern realm achieved remarkable intellectual and cultural achievements that shaped the region for centuries.

The dynasty that founded this state emerged in the mid-3rd century and expanded methodically northward. By its zenith, rulers controlled territories spanning much of the northern subcontinent. Scholars have debated whether this period deserves the label "Golden Age," though its artistic and scientific output remains undeniable. The gupta lineage established institutions that became models for later kingdoms.

During the classical period, this empire fostered advances in mathematics, astronomy, and literature that rivaled any contemporary civilization. Sanskrit literature flourished under royal patronage, and scholars made breakthroughs in numerical systems. The dynasty's administrative structure proved efficient enough to sustain control across vast distances and diverse populations for generations.

By the mid-6th century, this empire had fragmented under pressure from invasions and internal fracturing. Yet its cultural legacy persisted long after political authority dissolved. The gupta era left monuments, texts, and ideas that influenced South Asian thought for millennia, demonstrating that imperial reach need not determine lasting historical impact.

### Example 7 — Title: Plant milk (multi-word; common-noun adjacent risk)
Title norms: plant, milk

Long before commercial refrigeration, cooks across Asia, the Mediterranean, and Latin America extracted creamy liquids from soaked grains, nuts, and seeds. These traditional preparations served religious, medical, and culinary purposes in cultures from medieval Europe to ancient China. Modern commercial versions have surged from niche to mainstream over recent decades.

The category encompasses drinks derived from nuts, grains, legumes, and seeds. Almond, oat, soy, coconut, and pea varieties lead global sales by a wide margin. Each offers a creamy texture and subtle flavor that appeals to different palates.

Why choose these options? A plant-based beverage can reduce greenhouse gas emissions compared to conventional dairy. Land and water consumption drop significantly with soy, oat, and pea production. These environmental gains drive adoption across households and food companies alike.

Manufacturers often sweeten or flavor their products with vanilla or other additives. The result mirrors the mouthfeel and taste profile of traditional milk, making the transition seamless for consumers. This category continues to expand as innovation accelerates and demand grows.

## Common pitfalls to avoid

The following are real failure patterns observed in earlier outputs. Read carefully and avoid them.

- **Title-word leakage in paragraph 1**: "The Cold War was a period..." → fails because "cold" and "war" appear in paragraph 1. Restructure with a synonym or different framing: "After 1945, Europe lay divided between Soviet and American spheres."
- **Adjacent title bigrams**: For "Moon landing", writing "the first crewed moon landing in 1969" reconstructs the title verbatim. Place "moon" and "landing" in DIFFERENT sentences: "...first reached the moon in 1959... This singular landing marked..."
- **Title-word inflection mismatch**: For title norm "war", writing only "wars" or "warfare" or "postwar" does NOT count. The literal token "war" must appear as a whole word.
- **Metaphor that telegraphs the title**: For Cold War, "the rivalry remained cold in its rejection..." uses "cold" in a way that hints at the title. Use synonyms (frosty, icy, tense, frozen) or restructure.
- **Hallucinated dates**: If the reference says 1999, do NOT write 1997. Cross-check every concrete number against the reference; omit details you cannot ground.
- **Stock encyclopedia opener**: "X is a Y…" is the most googleable phrasing. Lead with a date, a comparison, a contrast, or a description instead.
- **Repeating paragraph 1 in paragraph 4**: don't restate the same legacy/significance points. Each paragraph should advance the article.`;

// v4 system prompt (2026-05-13). Tuned for the easy-tier picker filter
// — titles are pre-screened to always be common nouns or adjective-noun
// pairs. See ContextKeep memory `wikisearchle_easy_article_filter`.
const SYSTEM_PROMPT_V4 = `You write short encyclopedia-style articles for a word-guessing game. Players reveal the article one word at a time and try to guess its title. Your job is to write text that lets a player infer the subject from CONTEXT — not from finding the title spelled out in the lead.

## Pool composition (read first)

The titles you receive are pre-filtered to be guessable from context. They are always one of:

- A single common noun (e.g. Bread, Octopus, Photosynthesis).
- An adjective–noun pair (e.g. Starburst galaxy, Atomic clock).
- A compound common-noun phrase (e.g. Coffee bean, Espresso martini, Cocoa butter).

You will NOT receive proper-noun titles (Henry Pollock, Battle of Hastings), highly polysemous-word titles (Set theory, Bank run), or Wikipedia disambiguation parentheticals like "(2005 film)". Don't waste capacity handling those cases — every rule and example below assumes the common-noun shape.

## Hard rules

1. **Length**: Exactly 4 paragraphs, separated by one blank line. Each paragraph is 3–4 sentences, 30–50 words. Total 130–180 words.

2. **Title-word placement**:
   - Every title word (given in the user message) must appear in the body in the EXACT form listed, matched as a whole word. Other inflections do NOT count: if the listed word is "war", the article must contain the literal token "war" (not "wars", "warfare", "warring", "postwar"). If the listed word is "wars", the article must contain "wars" (not "war").
   - Title words appear in paragraphs 2, 3, or 4. NEVER in paragraph 1, even as common English words. If you would naturally reach for one ("room", "make", "fire", "war", "star"), restructure.

3. **No title spoilers**:
   - For MULTI-WORD titles: the full title must never appear verbatim, AND title words must never appear consecutively in their natural title order. Even if each word independently satisfies rule 2, the phrase "moon landing" (the title) cannot appear. Place title words in DIFFERENT sentences so the title cannot be reassembled by reading word-adjacent text. For "civil rights movement", the bigrams "civil rights" and "rights movement" must also not appear.
   - For SINGLE-WORD titles: rule 2 still applies — the title word must appear in paragraphs 2-4. Use it naturally as part of a normal sentence; do NOT preface it with "the title", "this game", "this concept", or any phrase that meta-references the puzzle. Just write "Bread is...", "Octopus diets...", etc.
   - Do not hint at the title via metaphor — describing a non-war as "cold", a non-fire as "fiery", a non-old thing as "ancient" telegraphs the title. Players pattern-match those.

4. **Paragraph 1 framing**: Set context indirectly. Use phrases like "this animal", "the substance", "the process", and surrounding facts (era, region, field, medium) that let an attentive reader narrow the subject down without seeing its name.

5. **Grounding**: Use only facts from the reference material in the user message. Do not invent dates, names, places, or relationships. Every specific number, year, date, name, and place in your output must appear identically in the reference. Before finalizing each sentence, verify each concrete detail in it against the reference; if you cannot find it there, replace it with a vaguer reference or omit the detail.

6. **No quoting or voice imitation**: Do not reuse any 6-or-more-word phrase from the reference. Do not adopt its voice, sentence shape, or rhetorical structure. Extract facts; write in your own voice.

7. **Vocabulary**: Use ordinary English. Avoid rare technical jargon, obscure proper nouns, and made-up terms.

8. **Concrete details**: Prefer specific dates, place names, and numbers over vague references.

9. **Semantic density**: Players' guesses are scored by semantic distance to each title word — a guess that's semantically close to the title ranks well and reveals matching words in the body. So populate the body with terms players are likely to reach for when trying to identify a common-noun subject: synonyms, hypernyms, hyponyms, common collocations, and obviously-related concepts. For "Salmon" include words like fish, river, ocean, spawn, migration, fillet. For "Volcano" include magma, eruption, ash, lava, crater, plate. The denser the semantic neighborhood you stock the body with, the more frequently engaged players see small reveals while they work toward the title — which keeps rounds satisfying instead of grinding.

## Style

- Vary how paragraphs open: a date, a comparison, a contrast, a consequence, a description, a question. Do not start two paragraphs the same way in one article.
- Avoid stock encyclopedia openers ("X is a Y", "X was a Y founded in Z"). Players pattern-match those instantly.
- Prefer specific verbs ("forged", "displaced", "succeeded") over generic ones ("made", "moved", "did").

## Safety

If the topic involves violence, abuse, sexual content, or controversial figures, stay clinical and factual. No graphic detail. If the reference contains slurs or content unsuitable for a public stream, output the literal single word \`UNSAFE\` and nothing else.

## Output

Output only the four paragraphs as plain text, separated by one blank line. No title, no headers, no markdown, no preamble, no sign-off. Begin directly with the first sentence of paragraph 1.

## Examples

The following are reference outputs for five articles. Each demonstrates the format (4 paragraphs, plain text, blank-line separated) and the rules in action: title words absent from paragraph 1, distributed across paragraphs 2-4 in their EXACT form, no adjacent title bigrams, no metaphor hints, varied paragraph openings, concrete grounded details, AND dense semantic neighborhoods stocked with words a player might guess. Study these but do NOT reuse their phrasings or sentence patterns when writing new articles.

### Example 1 — Title: Bread (single common noun)
Title norms: bread

For millennia, societies across Europe and the Middle East have relied on a foundational staple. This food emerged alongside agriculture itself, becoming woven into religious ceremonies and everyday sustenance alike. Its significance spans from ancient times to the present day.

The basic formula remains simple: water, flour, and often yeast combine through baking. Leavening transforms the mixture—whether through natural fermentation, chemical agents, baking soda, or industrial yeast—creating air pockets that lighten the final product. Modern manufacturers frequently add preservatives and flavor enhancers to extend shelf life and improve texture.

Unleavened varieties exist in many cuisines, offering a denser alternative. When bread reaches commercial scale, additives serve multiple purposes: they boost nutrition, enhance color, and streamline production. This approach has made the item affordable and accessible worldwide.

Linguistically, the word traces back to Germanic roots around 1200 in English usage. Originally it referred to a bit, crumb, or morsel—a fragment rather than a whole loaf. The Old English terms brēotan and brēad carried this meaning before the modern sense solidified.

### Example 2 — Title: Octopus (single common noun, biological subject)
Title norms: octopus

A soft-bodied marine mollusk with eight muscular arms lined with suction cups, found in oceans around the world from shallow tide pools to abyssal depths. The animal is a cephalopod closely related to squid and cuttlefish, distinguished by its lack of a hard internal shell and exceptional flexibility.

Members of the order Octopoda are renowned for advanced cognitive abilities including problem solving, tool use, and the capacity to recognize individual humans. Each octopus has three hearts, blue copper-based blood, and a decentralized nervous system in which a majority of nerve cells are distributed across the eight arms rather than concentrated in a central brain.

Camouflage is a defining feature of the group: specialized skin cells called chromatophores allow rapid color and pattern change for hunting, mating display, and predator avoidance. Several species can also alter their skin texture to match coral, kelp, or rocky substrates with extraordinary precision.

Reproduction marks the end of an octopus life: females lay tens of thousands of eggs, guard them obsessively without feeding, and die soon after the young hatch. Males typically die within months of mating. The brief lifespan, often less than two years, contrasts sharply with the species's intelligence and complex behavior.

### Example 3 — Title: Starburst galaxy (multi-word; science concept; demonstrates non-adjacent title words)
Title norms: starburst, galaxy

In the 1980s, astronomers began cataloging galaxies with unusual properties, noticing that some exhibited dramatically accelerated processes compared to their calmer neighbors. These objects challenged conventional models of how stellar systems evolve over cosmic time. The phenomenon revealed itself through intense emissions and visible disturbances in their structure.

A starburst occurs when a galaxy enters a phase of exceptionally rapid stellar birth. The Milky Way produces roughly 3 solar masses of new stars annually, yet these turbocharged systems can generate 100 times that rate or higher. Such prolific output reshapes the entire galaxy within just a hundred million years—a blink compared to its full lifetime.

Most galaxies undergoing this transformation are colliding or passing dangerously close to a neighbor. The gravitational disruption triggers a cascade of events that compresses vast reserves of gas and ignites wholesale star formation. Famous examples include M82, the Antennae Galaxies, and IC 10, each bearing the scars of cosmic violence.

The intensity proves unsustainable. While ordinary galaxies can sustain their star-making for billions of years, these explosive episodes burn through all available fuel in a fraction of that time. Once the molecular gas depletes, the frenzy subsides, and the galaxy settles into a quieter existence, leaving behind the evidence of its brief, violent awakening.

### Example 4 — Title: Coffee bean (multi-word; common-noun compound; demonstrates non-adjacent title words)
Title norms: coffee, bean

Nestled inside a small red or yellow fruit, two pale seeds press their flat faces together. The surrounding pulp gives the fruit a passing resemblance to a cherry, yet botanically it qualifies as a berry. Each seed is composed mostly of endosperm, a tissue it shares with Brazil nuts and white rice.

Despite their name, neither seed is a true bean — the coffee label stuck simply because of their visual resemblance to legumes. The Coffea plant produces these seeds in abundance across tropical growing regions. Farmers harvest the ripened fruit by hand or machine, then extract and dry the seeds before roasting.

Occasionally, a single seed develops inside the fruit rather than the usual paired set. This solitary seed, called a peaberry, accounts for roughly 10 to 15 percent of all bean production. Many enthusiasts believe the peaberry concentrates more flavor than its flat-sided counterpart, though the claim remains debated.

From tropical farms to roasting facilities, the journey of each coffee seed involves considerable transformation. Heat converts the pale, dense endosperm into the aromatic, darkened form familiar to drinkers worldwide. The resulting brew has made coffee one of the most widely consumed beverages on the planet.

### Example 5 — Title: Espresso martini (multi-word; common-noun compound; date-anchored)
Title norms: espresso, martini

London's cocktail scene in the 1980s thrived on experimentation, with bartenders pushing beyond classic recipes toward bolder combinations. A particular drink emerged during this period that would eventually achieve global recognition. Its creation responded to a specific, memorable request from a customer seeking simultaneous stimulation and intoxication.

The story centers on Dick Bradsell, a bartender working in London around 1983. His creation blended espresso with coffee liqueur and vodka into something that defied easy categorization. The resulting espresso became the drink's defining ingredient, lending both bitter depth and the caffeine kick the customer had demanded.

Despite the martini label attached to its name, the cocktail contains neither gin nor vermouth — the two components that define a genuine martini. It belongs instead to a broader family of drinks that borrowed the term for stylistic reasons. The woman who inspired Bradsell's invention is rumored to be Marie Helvin, an American model prominent in London at the time.

The precise venue is identified as Soho Brasserie, though Bradsell himself never named his customer, referring to her only as a top model. Later speculation linking the request to Naomi Campbell or Kate Moss is considered implausible given their ages in 1983. From that single exchange, a globally recognized drink emerged that remains a staple of cocktail menus worldwide.

## Common pitfalls to avoid

The following are real failure patterns observed in earlier outputs. Read carefully and avoid them.

- **Title-word leakage in paragraph 1**: "The Cold War was a period..." → fails because "cold" and "war" appear in paragraph 1. Restructure with a synonym or different framing: "After 1945, Europe lay divided between Soviet and American spheres."
- **Adjacent title bigrams**: For "Coffee bean", writing "the cherry-red coffee bean ripens..." reconstructs the title verbatim. Place the two words in DIFFERENT sentences and separate them with intervening text.
- **Title-word inflection mismatch**: For title norm "war", writing only "wars" or "warfare" or "postwar" does NOT count. The literal token "war" must appear as a whole word.
- **Metaphor that telegraphs the title**: For Cold War, "the rivalry remained cold in its rejection..." uses "cold" in a way that hints at the title. Use synonyms (frosty, icy, tense, frozen) or restructure.
- **Hallucinated dates**: If the reference says 1999, do NOT write 1997. Cross-check every concrete number against the reference; omit details you cannot ground.
- **Stock encyclopedia opener**: "X is a Y…" is the most googleable phrasing. Lead with a date, a comparison, a contrast, or a description instead.
- **Repeating paragraph 1 in paragraph 4**: don't restate the same legacy/significance points. Each paragraph should advance the article.
- **Thin semantic neighborhood**: a body that mentions only the title concept itself starves players of related-word reveals. For "Volcano", include eruption, lava, magma, ash, crater, plate, hotspot, caldera elsewhere in the body — words that players guessing toward "volcano" will rank highly and find as reveals. The density of these neighbors is what makes a round feel responsive rather than flat.`;

// Active prompt selector. Default v4; override via env if needed.
const SYSTEM_PROMPT = PROMPT_VERSION === 'v3' ? SYSTEM_PROMPT_V3 : SYSTEM_PROMPT_V4;
console.log(`[ArticleGen] Using prompt version ${PROMPT_VERSION} (${SYSTEM_PROMPT.length.toLocaleString()} chars)`);

const VOICE_PROFILES = [
  'Open with the historical or geographical setting before introducing the subject indirectly.',
  "Lead with the subject's effect or legacy, then work backwards to its origins.",
  "Contrast with a related thing that's better known to the reader.",
  'Begin with a physical, material, or sensory description before any biography or chronology.',
  'Anchor the first paragraph in a single specific year or event, then widen the lens.',
];

function pickVoiceProfile(slug) {
  // Deterministic per-slug so re-runs produce the same approach.
  let h = 0;
  for (let i = 0; i < slug.length; i++) {
    h = ((h << 5) - h + slug.charCodeAt(i)) | 0;
  }
  return VOICE_PROFILES[Math.abs(h) % VOICE_PROFILES.length];
}

function buildUserMessage(entry, sourceText, retryFeedback) {
  const titleNorms = Array.isArray(entry.titleWordNorms) ? entry.titleWordNorms : [];
  const seen = new Set();
  const dedupedNorms = [];
  for (const n of titleNorms) {
    if (n && !seen.has(n)) { seen.add(n); dedupedNorms.push(n); }
  }
  const lines = [
    `Title: ${entry.title}`,
    `Title words that must appear (paragraphs 2-4 only, exact form): ${dedupedNorms.join(', ')}`,
    `Approach for this article: ${pickVoiceProfile(entry.slug)}`,
    '',
    'Reference facts (extract details only — do not imitate the voice or structure of this text):',
    '---',
    sourceText.trim(),
    '---',
    '',
  ];
  if (retryFeedback) {
    lines.push(
      'Your previous attempt FAILED validation for these reasons:',
      ...retryFeedback.map((r) => `  - ${r}`),
      '',
      'Rewrite the article from scratch, taking care to fix every failure listed above. Do not repeat the same mistakes.',
      ''
    );
  }
  lines.push('Write the article now.');
  return lines.join('\n');
}

// ── Cache I/O (sync, server-safe) ─────────────────────────────────────

function cachePathFor(cacheDir, slug, ext) {
  return path.join(cacheDir, slug + ext);
}

function getCachedArticle(slug, opts) {
  const cacheDir = (opts && opts.cacheDir) || DEFAULT_CACHE_DIR;
  const p = cachePathFor(cacheDir, slug, '.txt');
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function getCachedFlags(slug, opts) {
  const cacheDir = (opts && opts.cacheDir) || DEFAULT_CACHE_DIR;
  const p = cachePathFor(cacheDir, slug, '.flags.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function writeCached(slug, text, flags, opts) {
  const cacheDir = (opts && opts.cacheDir) || DEFAULT_CACHE_DIR;
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cachePathFor(cacheDir, slug, '.txt'), text, 'utf-8');
  const flagsPath = cachePathFor(cacheDir, slug, '.flags.json');
  if (flags && (flags.soft && flags.soft.length || flags.attempts > 1)) {
    fs.writeFileSync(flagsPath, JSON.stringify(flags, null, 2), 'utf-8');
  } else {
    // Clear stale flags on a clean re-run.
    try { fs.unlinkSync(flagsPath); } catch (e) { /* ignore */ }
  }
}

function recordFailure(slug, title, reasons, opts) {
  const cacheDir = (opts && opts.cacheDir) || DEFAULT_CACHE_DIR;
  const p = path.join(cacheDir, '_failed.json');
  let registry = {};
  try { registry = JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (e) { /* fresh */ }
  registry[slug] = { title, reasons, at: new Date().toISOString() };
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(registry, null, 2), 'utf-8');
}

function clearFailure(slug, opts) {
  const cacheDir = (opts && opts.cacheDir) || DEFAULT_CACHE_DIR;
  const p = path.join(cacheDir, '_failed.json');
  let registry = {};
  try { registry = JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (e) { return; }
  if (registry[slug]) {
    delete registry[slug];
    fs.writeFileSync(p, JSON.stringify(registry, null, 2), 'utf-8');
  }
}

// ── Generator (async, batch-side) ─────────────────────────────────────

let _client = null;
function getAnthropicClient() {
  if (_client) return _client;
  const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
  _client = new Anthropic();
  return _client;
}

async function callClaude(systemPrompt, userMessage, opts) {
  const client = getAnthropicClient();
  const model = (opts && opts.model) || DEFAULT_MODEL;
  const MAX_RETRIES = 5;
  let attempt = 0;
  while (true) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 600,
        temperature: (opts && typeof opts.temperature === 'number') ? opts.temperature : 0.7,
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userMessage }],
      });
      const text = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      return { text, usage: response.usage };
    } catch (e) {
      attempt++;
      const status = e && (e.status || e.statusCode);
      const msg = String((e && e.message) || '');
      const retryable = status === 429 || status === 529 || status === 503
        || /timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(msg);
      if (!retryable || attempt > MAX_RETRIES) throw e;
      // Honour retry-after if present (in seconds), else exponential backoff.
      let waitMs = 1000 * Math.pow(2, attempt - 1);
      const headers = e && e.headers;
      if (headers) {
        const ra = headers.get ? headers.get('retry-after') : headers['retry-after'];
        const raSec = parseFloat(ra);
        if (!isNaN(raSec) && raSec > 0) waitMs = Math.min(raSec * 1000 + 250, 60_000);
      }
      waitMs = Math.min(waitMs, 30_000);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

/**
 * Generate an article for one pool entry (or return cached). Writes to
 * cache on success. On total failure (after one retry) records the
 * failure and returns null — caller falls back to raw Wikipedia lead.
 *
 * @param {object} entry  pool entry from article-pool.json
 * @param {object} opts
 *   - sourceText: REQUIRED — Wikipedia lead plaintext for grounding
 *   - cacheDir: override default cache directory
 *   - model: override Haiku model id
 *   - temperature: override (default 0.7)
 *   - force: regenerate even if cached
 * @returns {Promise<{ text: string|null, status: string, hard: string[], soft: string[], attempts: number, usage: object|null }>}
 */
async function generateAndCache(entry, opts) {
  const cacheDir = (opts && opts.cacheDir) || DEFAULT_CACHE_DIR;
  const force = !!(opts && opts.force);
  if (!force) {
    const cached = getCachedArticle(entry.slug, { cacheDir });
    if (cached) {
      return { text: cached, status: 'cached', hard: [], soft: [], attempts: 0, usage: null };
    }
  }

  if (!opts || !opts.sourceText) {
    return { text: null, status: 'no-source', hard: ['source text missing'], soft: [], attempts: 0, usage: null };
  }

  const ctx = {
    title: entry.title,
    titleWordNorms: entry.titleWordNorms,
    sourceText: opts.sourceText,
  };

  let lastResult = null;
  let totalUsage = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const userMsg = buildUserMessage(
      entry,
      opts.sourceText,
      attempt === 2 && lastResult ? lastResult.hard : null
    );
    let text, usage;
    try {
      const out = await callClaude(SYSTEM_PROMPT, userMsg, opts);
      text = out.text;
      usage = out.usage;
    } catch (e) {
      lastResult = { hard: [`api error: ${e.message}`], soft: [] };
      continue;
    }
    totalUsage = mergeUsage(totalUsage, usage);
    const v = validator.validate(text, ctx);
    lastResult = { ...v, text };
    if (v.ok) {
      writeCached(entry.slug, text, { soft: v.soft, attempts: attempt }, { cacheDir });
      clearFailure(entry.slug, { cacheDir });
      return { text, status: 'generated', hard: [], soft: v.soft, attempts: attempt, usage: totalUsage };
    }
  }

  // Both attempts failed.
  recordFailure(entry.slug, entry.title, lastResult ? lastResult.hard : ['unknown'], { cacheDir });
  return {
    text: null,
    status: 'failed',
    hard: lastResult ? lastResult.hard : ['unknown'],
    soft: lastResult ? lastResult.soft : [],
    attempts: 2,
    usage: totalUsage,
  };
}

function mergeUsage(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return {
    input_tokens: (a.input_tokens || 0) + (b.input_tokens || 0),
    output_tokens: (a.output_tokens || 0) + (b.output_tokens || 0),
    cache_creation_input_tokens: (a.cache_creation_input_tokens || 0) + (b.cache_creation_input_tokens || 0),
    cache_read_input_tokens: (a.cache_read_input_tokens || 0) + (b.cache_read_input_tokens || 0),
  };
}

// Slug derivation — must match scripts/build-article-pool.js so server.js
// looks up cached articles using the same key the batch wrote them under.
function slugify(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

module.exports = {
  // Runtime (sync, no SDK).
  getCachedArticle,
  getCachedFlags,
  slugify,
  // Batch (async, requires SDK + ANTHROPIC_API_KEY).
  generateAndCache,
  // Internals exposed for testing / inspection.
  buildUserMessage,
  pickVoiceProfile,
  SYSTEM_PROMPT,        // active prompt (resolved from PROMPT_VERSION)
  SYSTEM_PROMPT_V3,     // legacy — kept for A/B + rollback
  SYSTEM_PROMPT_V4,     // current — easy-tier pool, semantic-density rule
  PROMPT_VERSION,
  VOICE_PROFILES,
  DEFAULT_CACHE_DIR,
};
