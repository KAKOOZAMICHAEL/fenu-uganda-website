/**
 * Run this ONCE to fix the testimonials conflict:
 *   node fix-testimonials-db.js
 *
 * What it does:
 *  1. Deletes all collection-based testimonials (the ones that were
 *     causing duplicate/extra slides)
 *  2. Deletes any cms_sections entries that were accidentally storing
 *     image paths for testimonials as empty/wrong values
 *  3. Confirms the fix worked
 */

const db = require('./db');

console.log('--- FENU Testimonials Fix ---\n');

// 1. Remove collection testimonials (these caused extra slides)
const del1 = db.prepare("DELETE FROM cms_collections WHERE collection_key = 'testimonials'").run();
console.log(`Removed ${del1.changes} collection testimonial record(s).`);

// 2. Remove any broken cms_section entries for testimonial images
//    (empty content_html means the image was never actually saved properly)
const del2 = db.prepare(
  "DELETE FROM cms_sections WHERE section_key LIKE 'home-testimonial-img-%' AND (content_html = '' OR content_html IS NULL)"
).run();
console.log(`Removed ${del2.changes} empty testimonial image section(s).`);

// 3. Show what testimonial image sections remain (the valid ones)
const remaining = db.prepare(
  "SELECT section_key, content_html FROM cms_sections WHERE section_key LIKE 'home-testimonial%' ORDER BY section_key"
).all();

if (remaining.length === 0) {
  console.log('\nNo saved testimonial data found — the page will show its default images.');
} else {
  console.log('\nSaved testimonial data remaining:');
  remaining.forEach(r => {
    const preview = r.content_html ? r.content_html.substring(0, 60) : '(empty)';
    console.log(`  ${r.section_key}: ${preview}`);
  });
}

console.log('\n✓ Done. Restart your server with: node index.js\n');
