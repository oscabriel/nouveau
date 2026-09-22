/**
 * The Thornton 1808 Coffea arabica branch, the one drawing the site is
 * allowed to be colorful with (ADR-0012). One export in `public/`, trimmed
 * to the drawing with a 16px transparent margin, from a 3260px PNG master
 * kept outside the repo. The wordmark carries it as an image and as its own
 * alpha mask; the about page shows it as the plate. The flower in the footer
 * is `public/coffea-arabica-flower.webp`. Regenerate the branch with
 * ImageMagick:
 *
 *   magick 01-branch.png -trim +repage \
 *     -bordercolor none -border 16 -filter Lanczos -resize 1600x \
 *     -quality 78 -define webp:alpha-quality=90 -define webp:method=6 \
 *     public/coffea-arabica.webp
 */
export const BRANCH_SRC = "/coffea-arabica.webp";
export const BRANCH_WIDTH = 1600;
export const BRANCH_HEIGHT = 1671;
