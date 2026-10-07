# Showroom Manager — Billing Edition (Web App / PWA)

MyBillBook जैसा **showroom billing app** — GST invoice, estimate, barcode billing, stock aur reports.
पूरा offline चलता है, data आपके phone/browser में ही रहता है (कोई login नहीं, कोई server नहीं)।

इस repo का **root ही पूरा web app** है (Vite + React + TypeScript) — phone में "Add to Home screen" करके
native app की तरह install किया जा सकता है। (Android/APK वाला हिस्सा अलग repo/folder में रहता है।)

---

## ✨ क्या-क्या है (Billing strong)

### 🧾 Billing (मुख्य)
- **Tax Invoice / पक्का बिल (GST)** — CGST+SGST या IGST (place of supply के हिसाब से) automatic
- **Estimate / Quotation**, **Proforma Invoice**, **Delivery Challan**, **Bill of Supply** (बिना GST), **Credit Note / Sales Return**
- **Item-wise discount % + Bill-level discount** (₹ या %), extra charges (freight/hamali), round-off
- **Barcode / quick billing** — barcode scan करके या नाम/code से item tap करके 2 second में bill
- USB/Bluetooth barcode scanner (keyboard-type) भी चलता है — code box में type करके Enter
- **Bill number series** per document type — जैसे `INV/25-26/001`, `EST/25-26/007` (Settings से बदल सकते हैं)
- **Payment tracking** — पूरा paid / आधा / **उधार (credit)**; cash, UPI, card, bank, cheque
- **WhatsApp पर bill** — पूरे bill का text message, या bill की **image** (native share sheet)
- **UPI QR** — बाकी amount का QR bill पर छपता है (PhonePe/GPay/Paytm scan करके pay)
- **Print / PDF** — A4 invoice (professional layout) और **80mm thermal printer** layout
- Estimate → Tax Invoice **convert**, bill duplicate, credit note बनाना, bill cancel (stock वापस) / delete

### 📦 Items & Stock
- Item master: code, barcode, brand, category, sub-category, HSN, unit, MRP, discount %, GST %, purchase rate, stock, low-stock alert
- Sale price + **margin per piece** live calculation
- Stock खुद कट जाता है bill पर (cancel/credit note पर वापस जुड़ जाता है)
- **CSV import/export** (Excel) — Android app की पुरानी CSV file भी चलती है; template भी download हो सकता है

### 📥 Purchase (supplier se maal)
- **Purchase Bill** — supplier का bill अपनी दुकान के नाम से लिखें, **stock अपने आप बढ़ता है**
- GST उसी तरह लगता है (intra-state → CGST/SGST, दूसरे state का supplier → IGST)
- Supplier का **payable** अपने आप बनता है; आधा/पूरा payment दर्ज करें
- Purchase rate से item का **cost (purchase price) update** कर सकते हैं
- अपना bill number series: `PUR/25-26/001`

### 👥 Khata / Parties
- Customer & Supplier list, **किसका कितना बाकी है** (udhaar khata)
- Customer: *lena hai* / *advance jama*; Supplier: *dena hai* / *advance diya*
- Ledger — party के सारे bills, total business, paid, बाकी
- **WhatsApp payment reminder** एक tap में (customer को माँगने, supplier को हिसाब clear करने)
- Opening balance (पुराना बकाया) support

### 💸 Payments In / Out (रोज़ का cash register)
- Seedha **payment entry** — customer से पैसा आया या supplier को दिया
- किसी **bill के against** लिखें (उस bill का "बाकी" भी update हो जाएगा) या **on-account / advance**
- Mode: Cash, UPI, Card, Bank, Cheque + note (UPI ref/cheque no.)
- Period filter (आज / 7 दिन / महीना / FY / custom), **mode-wise total**, entry delete
- Register में bill-wise और khata-wise — दोनों payments एक जगह

### 🧾 Expenses (दुकान का खर्चा)
- 9 ready categories: kiraya, staff/salary, बिजली-मोबाइल, transport, packing, marketing, repair, chai-paani, other
- Category-wise **bar chart**, mode-wise summary, period filter, CSV export
- **Net profit = sale profit − kharcha** (Reports में दिखता है)

### 📊 Reports
- Net sale, taxable value, GST collected, discount, gross profit, **purchase total** aur **kharcha**
- **Net profit** (sale profit − kharcha) — asli kamai ka andaza
- **Din-wise sale chart** aur **mahine-wise sale vs purchase** chart
- Top items, top parties, payment-mode summary, document-type summary
- **Udhaar Aging report** — 0–30, 31–60, 61–90, 90+ दिन (lena hai / dena hai), on-account payments adjust hoke; CSV export
- **Day book** — किसी भी दिन का पूरा हिसाब: bills + payments + kharcha, CSV export
- **GST / HSN summary** (GSTR-1 जैसा) — CGST/SGST breakdown
- Stock value report + low-stock list
- सब reports **CSV export** (sales register, GST summary, item-wise, party-wise, aging, day book)

### ☰ More (ek hi jagah se sab)
- Koi bhi document banayein (7 types), khata, payments, expenses, reports, settings — sab ek tap par
- Receivable / payable / mahine ki sale / low stock — ek nazar me
- दुकान की details (नाम, address, phone, GSTIN, state, UPI ID, bank) + **logo & signature upload**
- Per-document number series, default terms & conditions
- **Backup / restore** (JSON file) + full data reset
- App install (PWA) button

---

## 🚀 चलाने का तरीका (development)

```bash
npm install
npm run dev        # http://localhost:5173
```

दूसरे device/network से खोलने के लिए server पहले से `0.0.0.0` पर bind है।

Production build:

```bash
npm run build      # dist/ बनेगा (offline PWA + service worker के साथ)
npm run preview    # build को local test
```

## 📱 Phone में app की तरह install कैसे करें
1. App को Android **Chrome** में खोलें (HTTPS link होना चाहिए)
2. Menu (⋮) → **“Install app” / “Add to Home screen”**
3. Home screen पर 🏪 icon आ जाएगा — बिना internet भी खुलेगा

> Data browser storage (IndexedDB) में रहता है। इसलिए महीने में एक बार
> **Settings → Backup** से JSON file ज़रूर निकाल लें। Browser data clear करने पर data चला जाएगा।

## 🖥️ Preview / static build (node_modules ke bina bhi chalta hai)

Kuch environments (jaise sandbox/CI) `node_modules` ko save nahi rakhte — us case me dev server
(`npm run dev`) band ho sakta hai. Isliye ek **pre-built static** version bhi rakha jaata hai:

```bash
npm run build:preview     # dist build karke preview-build/ folder banata hai
npm run serve:static      # http://localhost:4173  (koi node_modules nahi chahiye)
```

Build hone ke baad `preview-build/` folder kisi bhi static hosting (ya `python3 -m http.server`)
se serve ho jata hai — app wahi pura kaam karta hai (offline bhi, kyunki service worker saath aata hai).
Windows par serve karne ke liye `npx serve preview-build` ya VS Code ka Live Server bhi chalega.



### ☁️ Cloud account (Google / Email) + data sync

MyBillBook jaisa: **login karein → company ka pura data cloud me sync** → doosre phone me usi account se login
karte hi sab wapas mil jata hai (items, bills, khata, payments, expenses, bill numbering).

Setup **ek baar** karna padta hai (free Firebase project, ~5 min) — app ke andar hi poora guide hai:
**Settings → ☁️ Cloud account → "Cloud setup karein"**

1. https://console.firebase.google.com → **Add project**
2. **Authentication → Get started** → **Email/Password** enable (Google login ke liye **Google** bhi)
3. **Firestore Database → Create database** → Production mode → **asia-south1**
4. Firestore **Rules** me ye paste karke Publish karein:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{db}/documents {
       match /showroomUsers/{uid}/{doc=**} {
         allow read, write: if request.auth != null
                            && request.auth.uid == uid;
       }
     }
   }
   ```

5. **Project settings → Your apps → Web** → `firebaseConfig` copy karke app me paste karein
6. **Authentication → Settings → Authorized domains** me apni site ka domain add karein

Uske baad **Login / Sign up** — email+password ya **Google se login** (browser me). Login ke baad sync khud
chalta hai (app khulte hi + har 3 minute me), aur "Saari companies sync" se ek hi baar me sab companies sync ho jati hain.

**Sync kaise kaam karta hai**

- Data `showroomUsers/{uid}/companies/{companyId}` document me JSON snapshot ke roop me jata hai.
- Merge **natural key** par hota hai (item code, bill number, party naam, payment date+amount…): dono taraf same row
  ho to **naya wala jeetta hai**, naya row ho to **jud jata hai**, aur id clash ho to naya id milta hai +
  invoice/payment ke references (partyId, itemId) apne aap theek ho jate hain.
- Har company ka data alag — ek account me multiple firms, jaise MyBillBook me.
- Offline-first: internet na ho to app waise hi chalti hai; sync baad me ho jata hai.
- APK (WebView) me Google login Google ki policy se block hai — wahan **email/password** se login karein
  (web app me Google button chalta hai).

Technical: `src/lib/cloud.ts` (Firebase Auth + Firestore REST, koi SDK nahi — bundle chhota rehta hai) aur
`src/lib/sync.ts` (snapshot + merge). Smoke test me mock Firebase se poora flow verify hota hai.

### 🔐 Users & login (offline)

- Settings → **👤 Users & login** → naya user banayein (naam, role, 4-6 ank ka PIN).
- **Jab tak koi user na bane, app bina login khulti hai** — user banate hi agla khulne par PIN maangta hai.
- **Owner** PIN bhool jaye to login screen se naya PIN bana sakta hai; staff ko owner se naya PIN lena hoga.
- PIN ka hash phone me hi rehta hai (SHA-256). Login/session tab band hone par khatam.

### 🏢 Company / Firm (multi-company)

- Settings → **🏢 Company / Firm** → **switch** ya **＋ Nayi company** banayein.
- Har company ka **pura data alag** hota hai (alag IndexedDB database): items, bills, khata, payments, expenses, users.
- Nayi company **khaali** shuru hoti hai (sample items sirf pehli company me aate hain) aur uska naam onboarding me apne aap aa jata hai.
- Company switch karte hi app reload hoti hai aur us company ka data khul jata hai.

### 📄 Ek hi file wala version (single-file HTML)
Kuch jagah (preview iframe, purane phone browser, WhatsApp par share) ke liye ek hi file sabse aasan hai:

```bash
npm run build:single      # banata hai: showroom-manager-app.html  (~820 KB)
```

Us ek file me **pura app** (JS + CSS) inline hai. Ise:
- kisi bhi browser me seedha khol sakte hain (double-click / file:// bhi chalta hai),
- WhatsApp/email par bhej sakte hain,
- kisi bhi static hosting par daal sakte hain.

Data usi browser me (IndexedDB) save hota hai, isliye ek hi browser me use karein.

## 🌐 Deploy
GitHub Actions workflow `.github/workflows/deploy-webapp.yml` — `main` branch पर push होने पर webapp build होकर
**GitHub Pages** पर deploy हो जाता है (https://<user>.github.io/showroom-manager1/)।
इसी HTTPS link को phone में खोलकर install किया जा सकता है।

## 🧪 Testing (smoke test)

Poore billing flow ka automated test hai (jsdom + fake IndexedDB) — isi se data layer aur UI dono check hote hain.

**Sirf ek command** (repo root se — packages khud install ho jayenge):

```bash
npm run smoke
```

Pehli baar chala rahe hain? Kuch aur nahi karna — script khud `npm install` kar leti hai (agar packages nahi mile)
aur phir **61 checks** chalati hai: 43 billing-engine checks + 18 UI flow checks (jsdom me asli app khol kar
onboarding → item → bill → invoice → khata → reports/payments/settings screens tak). Typecheck bhi saath chahiye to:
`npm run verify`

### ⚠️ Phir bhi nahi chala? Ye 3 cheezein check karein

| Error | Wajah | Fix |
| --- | --- | --- |
| `npm: command not found` | Node.js install nahi hai | Node 22 install karein: https://nodejs.org (ya `winget install OpenJS.NodeJS` / `brew install node`) |
| `npm ERR! network` / install fail | internet/proxy ya company firewall | mobile hotspot se try karein, ya `SMOKE_NO_INSTALL=1` ke saath manual `npm install` |
| `Missing script: "smoke"` | aap purane commit/branch par hain (jisme app code nahi tha) | `git fetch` karke latest branch pull karein — ya PR merge karke `main` le lein |
| `Node ... is not supported` | Node purana (20 se kam) | Node 22 install karein |

**Terminal hi nahi chahiye?** App ke andar hi self-test hai: **Settings → 🧪 App self-test** (43 checks, browser me,
bill banake, payment lekar, purchase karke, sync merge tak — aur ant me sab rollback, aapka data safe).

GitHub par har push ke saath ye test apne aap (clean environment me) chalta hai —
workflow: `.github/workflows/webapp-test.yml` → tab **Actions → Web App Smoke Test** me result dikhta hai.

### 🧪 App ke andar wala self-test (bina terminal)
**Settings → 🧪 App self-test** dabayein. Ye usi billing engine ko browser me chalata hai — **43 checks**:
invoice maths (GST/CGST/SGST/IGST, bill discount, round off), bill number series, stock cut/restore,
payment recording, khata balance, credit note, **purchase bill (stock IN + payable)**, **payments in/out register**,
**expenses**, **udhaar aging**, CSV import/export, backup-restore, users & PIN, multi-company isolation,
aur **sync merge** (natural key, delete propagation, ID clash). Test ek temporary company (alag database) me
chalta hai aur **ant me wo database delete** kar deta hai — aapka asli data bilkul safe rehta hai.

## 🧱 Tech
Vite + React 19 + TypeScript + Tailwind CSS 4 + Dexie (IndexedDB) + vite-plugin-pwa + qrcode.react + html2canvas-pro

```
src/
  lib/        types, db (Dexie), repo (billing + khata + purchase + expenses + aging), calc (GST maths),
              format, doc (WhatsApp/UPI), csv, backup, cloud (Firebase REST), sync, keys (natural keys),
              reports, print, session, selftest  — isi layer me poora business logic hai
  components/ UI primitives, InvoicePaper (A4 + thermal), BarcodeScanner, ItemPicker/PartyPicker,
              PeriodPicker, PaymentRegister, Charts, Toasts
  screens/    Home, Billing, InvoiceView, Invoices, Items, Parties, Payments, Expenses, Reports, More,
              Settings, Onboarding, Login
smoke/        automated test (jsdom + fake-indexeddb): engine + UI flow  → npm run smoke
scripts/      make-single (single-file HTML), make-preview, serve (static server)
```

## 🗄️ Database versions
- **v1** — business, items, parties, invoices, payments, expenses, docSettings, appSettings, users
- **v2** — tombstones (sync me delete propagate karne ke liye, natural key par keyed) + indexes
  (migrate apne aap hota hai, data safe rehta hai)

Har company ka apna IndexedDB database hota hai (`showroom-db`, `showroom-db-<companyId>`) — isi liye
ek firm ka data doosri firm me kabhi leak nahi hota.
