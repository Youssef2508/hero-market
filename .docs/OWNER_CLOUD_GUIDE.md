# HeroMarket from your phone: the owner's guide

Written for the store owner. It covers what you do yourself once the cloud server is set up ([CLOUD_DEPLOYMENT.md](CLOUD_DEPLOYMENT.md) is for whoever sets up the server).

## What it is

The shop PC is still your store. The cloud is a copy of it on the internet that you open from your phone's browser at your store's address (for example `https://myshop.example.com`). It is the same program with the same screens, users, permissions, shifts and accounts.

- **While the shop PC is connected,** what you do on the phone is carried out on the shop PC itself, and you see the shop's figures as they are, usually within a second.
- **While the shop PC is off or offline,** the phone keeps working on the cloud's copy. A strip at the top says so. When the PC comes back, both sides' work comes together by itself. Anything that needs a person (the same price changed on both sides, the last item sold twice) appears under «تحتاج انتباهك».
- **A few things only work while the shop is connected:** changing a barcode; deleting a product, supplier, user or role; and resetting the data. The phone tells you when you try.
- Invoices made on the phone while the shop was offline are numbered **W-1, W-2, …** so they never look like the shop's. Typing «W-5» in the invoice search finds the fifth one.

## Once, at the start

1. **The backup key.** Whoever sets up the server makes it with you on your computer (`heromarket-backup-key.txt`). Keep two copies offline, for example on two USB sticks in different places. Without it, the cloud's backups cannot be read by anyone, you included.
2. **The server secret.** You also keep a copy of one long secret from the server's settings, apart from the server. Treat it like the key.
3. **Linking the shop PC.** On the shop PC: «المزامنة السحابية» → enter the cloud's address and the one-time code you are given (valid 15 minutes). Check that the store name shown is yours.
4. **Who may use the phone.** Administrators may by default. To let someone else in, give their role «الدخول عبر الإنترنت» under «الأدوار والصلاحيات». What they can do on the phone is exactly what they can do at the shop.
5. **On your phone:** open the address and sign in with your usual username and password. To add it to your home screen, use your browser's menu and choose "Add to Home screen" (or "Install").

Your password is the same one you use at the shop. If you never chose one (you still sign in with a PIN), choose it at the shop first: the phone does not accept PINs.

## Every day

Nothing. The shop PC keeps the link by itself, even with the program closed. The sync screen on the PC shows «خدمة المزامنة في الخلفية» when it does.

## If something is wrong

| You see                                                         | What it means and what to do                                                                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| «المتجر غير متصل الآن…» at the top of the phone                 | The shop PC is off or has no internet. You can keep working; it comes together when the PC is back.                                   |
| «محاولات دخول خاطئة كثيرة. حاول مرة أخرى بعد … ثانية.»          | Wrong passwords for your name (from anywhere) paused internet sign-in for 15 minutes. The shop PC is not affected.                    |
| «تحتاج انتباهك» shows a number                                  | Open it. Each item says what happened. Fix it with the usual screens, then mark it settled with a note.                               |
| A message that the shop and the cloud are on different versions | Both must be updated to the same version. Ask whoever maintains your installation.                                                    |
| A lost phone                                                    | At the shop, change your password: every other session, the lost phone's included, is signed out.                                     |
| A new shop PC                                                   | Install HeroMarket on it, then link it with a new code from the server. The old PC is refused from then on; the store's data is kept. |
