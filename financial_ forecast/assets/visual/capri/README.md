# Capri sprite asset

`sprites.png` is generated pixel fan art of Capricorn / Capri for this project's
map companion, created with the built-in image-generation tool. It is not an
official sprite or a frame ripped from the show. Character: Cyberpunk:
Edgerunners 2, CD PROJEKT RED / Studio Trigger / Netflix.

Visual reference (used for generation, not bundled as a project asset):
https://github.com/balaqiang/capri-desktop/blob/master/assets/capri/capri-cutout.png

The transparent 1774 × 887 PNG contains four columns. The top 40% contains four
red glitch-orb poses; the bottom 60% contains closed-mouth, small talking-mouth,
open talking-mouth and blink poses. `GUI/capri.js` selects the animation frames;
CSS uses the appropriate source-row proportions and pixelated rendering. The
character pops out when chat opens and cycles talking frames as a reply types.

## Generation prompt

Use case: stylized-concept. Asset type: production 2D pixel-art game sprite sheet
for a small web map companion. Reference image: Capricorn / Capri from Cyberpunk
Edgerunners 2; preserve her huge jagged red/magenta hair silhouette, black slender
angular body with red and green geometric patches, small vivid green eye panel
and playful expression. One wide transparent sprite sheet, four equal columns
and two rows, no text, labels, grid, ground or interface. Top row: the same
compact bright crimson glitch-energy orb built of angular red pixel fragments,
four small variations for a looping hover/pulse animation. Bottom row: full-body
pixel-art Capri, same framing and baseline, complete hair and feet inside each
cell; neutral mouth closed, mouth slightly open and one hand raised, mouth open
with playful pose, then mouth closed with blink. Limited chunky arcade palette,
crisp pixel edges, no gradients or antialiasing halo. Very long thin black limbs,
green eye area; red hair and orb share electric crimson. Genuine transparent alpha.
