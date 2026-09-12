# MyPortfolio
Responsive Portfolio crafted using HTML, CSS, Bootstrap, and Javascript.

Link: https://siddharth0801.github.io/MyPortfolio/

## UPI Spend Tracker

`expense-tracker/` is a standalone, installable web app (PWA) hosted at
https://siddharth0801.github.io/MyPortfolio/expense-tracker/

- Imports password-protected PNB One statements (.xls/.xlsx/.csv); decryption and parsing happen in the browser, nothing is uploaded.
- Categorises UPI payments by merchant, shows what you pay for, and warns when today or this month is running above your own averages (optional monthly budget).
- Data stays in the browser (localStorage) with JSON backup/restore.

Tests: `cd expense-tracker && node --test tests/*.test.js`
