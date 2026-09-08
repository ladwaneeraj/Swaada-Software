# Menu photos

Drop a real photo in here and it replaces that item's illustration on the
order screen, the menu manager and everywhere else — automatically, with no
code change.

**Naming:** the menu item's id without its `itm-` prefix.

| Item id                | File name             |
| ---------------------- | --------------------- |
| `itm-paneer-pizza`     | `paneer-pizza.webp`   |
| `itm-masala-tea`       | `masala-tea.webp`     |
| `itm-french-fries`     | `french-fries.webp`   |

Item ids live in `src/data/seed.ts`.

**Format:** `.webp` preferred (`.avif`, `.jpg`, `.png` also work). Shoot or
crop roughly 5:4 landscape — the cards crop to that. Around 600×480 and
under ~80 KB per photo keeps the whole menu fast on café wifi.

Anything without a photo here keeps the bundled illustration in
`public/menu/`, so a half-filled folder still looks finished.
