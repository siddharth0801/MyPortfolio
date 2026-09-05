# MyPortfolio

Responsive personal portfolio, built with plain HTML, CSS, Bootstrap 5 and
vanilla JavaScript. No build step, no dependencies, no npm.

**Live:** https://siddharth0801.github.io/MyPortfolio/

## Editing the content

**All site content lives in [`data/content.js`](data/content.js).** Edit that one
file, save, refresh. You should not need to touch the HTML to change anything you
see on the page.

| To change… | Edit |
|---|---|
| Name, greeting, bio, typewriter roles, CV link | `profile` |
| Page title, browser tab, nav links, footer name | `site` |
| Degrees and schools | `education` |
| The skills grid | `skills` |
| The project cards | `projects` |
| Social links (About buttons *and* footer icons) | `socials` |
| Contact form fields and Formspree endpoint | `contact` |

A few conventions worth knowing:

- **Adding things is just adding an array entry.** The skills grid reflows to
  however many entries there are, and the project row is responsive — no markup
  or CSS changes needed.
- **Each social link is stored once.** `showIn: ["about", "footer"]` decides where
  it appears, so the About button and the footer icon can never drift to
  different URLs.
- **Values are HTML-escaped.** If you genuinely need markup, use a key ending in
  `Html` (`degreeHtml: "12<sup>th</sup>"`), which is inserted raw.
- **The copyright year is computed** at render time. Don't hardcode it.
- **The "View CV" button** points at `profile.cv.url`. Drop your PDF in
  [`assets/`](assets/), or set `url` to `""` to hide the button entirely rather
  than ship a link that 404s.

The file is JavaScript rather than JSON on purpose: a plain `<script>` tag works
when you open `index.html` straight from disk (fetching a local JSON file is
blocked by the browser), and it tolerates trailing commas and `//` comments.

## Running locally

Open `index.html` in a browser — that is enough for most edits.

To match GitHub Pages exactly (which is case-sensitive about file paths), serve
it over HTTP:

```bash
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Checking your edits

```bash
node scripts/check-content.mjs
```

Dependency-free. It verifies that every icon and image path resolves **with the
exact case on disk** — the mistake that works locally and 404s on GitHub Pages —
that every URL parses, that no two socials share a name, and that project images
have alt text. It runs on every push via
[`.github/workflows/check.yml`](.github/workflows/check.yml).

## Layout

```
index.html          section shells and mount points only
data/content.js     ← all content lives here
js/render.js        builds each section from the data
js/typewriter.js    the animated role line
js/contact.js       contact form submit
js/main.js          boot
css/style.css       design tokens in :root, then components
icons/              skill icons and project images
assets/             CV goes here
scripts/            content validation
```

## Third-party

Bootstrap 5.3.3 and Font Awesome 6.7.2 load from jsDelivr with Subresource
Integrity hashes. Fonts come from Google Fonts. The contact form posts to
[Formspree](https://formspree.io/).
