# Lužická — účet domácnosti

Soukromá webová aplikace pro transparentní rozúčtování nájmu, energií, služeb domu a společných nákupů mezi obyvateli bytu. Lze ji provozovat lokálně nebo v cloudu na Railway bez domácího počítače.

## Co umí

- měsíční dashboard s předpisem, přijatými platbami a zůstatkem každé osoby;
- nájemné, služby domu, internet, zálohy na elektřinu a plyn;
- roční vyúčtování včetně záporných položek (vratky/přeplatky);
- ad hoc společné nákupy;
- výchozí váhy osob a výběr, koho se konkrétní položka týká;
- pravidelné šablony a idempotentní vygenerování měsíce;
- odečty elektroměru a plynoměru;
- CSV export pro Excel a tiskovou stránku pro PDF;
- stornování místo mazání a administrátorský audit změn;
- oddělený čtenářský a administrátorský přístup.

Konkrétní rozdělení každého nákladu se ukládá v haléřích. Pozdější změna jména, aktivity nebo váhy osoby tedy nepřepíše historii.

## Doporučené nasazení bez domácího počítače: Railway

Railway aplikaci spustí přímo z tohoto GitHub repozitáře a poskytne veřejnou HTTPS adresu. Přístup k obsahu zůstává chráněný čtenářským nebo administrátorským heslem.

### 1. Vytvoření služby

1. Přihlaste se na Railway pomocí GitHubu.
2. Zvolte **New Project → Deploy from GitHub Repo**.
3. Vyberte repozitář `DaveZajicek5/luzicka` a větev `main`.
4. Railway načte `railway.json`, sestaví Node.js aplikaci a použije endpoint `/health` pro ověření nasazení.

### 2. Připojení trvalého disku

Bez Volume by se SQLite databáze při novém nasazení ztratila.

1. Na projektovém plátně zvolte **Create/Attach Volume**.
2. Připojte Volume ke službě s aplikací.
3. Nastavte mount path na `/data`.

Aplikace automaticky rozpozná `RAILWAY_VOLUME_MOUNT_PATH` a uloží databázi jako `/data/luzicka.sqlite`. `DATABASE_PATH` proto na Railway není nutné nastavovat.

### 3. Proměnné služby

V záložce **Variables** přidejte:

```dotenv
VIEWER_PASSWORD=97E690DC
ADMIN_PASSWORD=zvolte-jine-dlouhe-a-silne-heslo
SESSION_SECRET=zvolte-dlouhy-nahodny-retezec
HOUSEHOLD_NAME=Lužická
SESSION_HOURS=12
```

`HOST`, `PORT`, `LAN_ONLY`, `SECURE_COOKIES` a `DATABASE_PATH` na Railway nenastavujte. Aplikace pro cloud automaticky použije:

- `HOST=0.0.0.0`;
- dynamický port přidělený Railway;
- `LAN_ONLY=false`;
- HTTPS-only session cookie;
- databázi na připojeném Volume.

`SESSION_SECRET` lze vytvořit například v libovolném důvěryhodném generátoru jako alespoň 32 náhodných bajtů. Nesmí být stejný jako žádné přihlašovací heslo.

### 4. Veřejná adresa

Ve službě otevřete **Settings → Networking → Generate Domain**. Vygenerovanou HTTPS adresu lze uložit na plochu iPhonu a sdílet se spolubydlícími. Bez správného hesla se data nezobrazí.

### 5. Zálohy

Zapněte Railway Volume backups. SQLite databáze obsahuje veškeré finanční záznamy, takže samotný GitHub repozitář není záloha dat.

## Lokální spuštění

Vyžaduje **Node.js 22.9+**. Aplikace nemá žádné balíčkové závislosti.

```bash
cp .env.example .env
# upravte hesla a SESSION_SECRET
npm start
```

Otevřete `http://127.0.0.1:8787`. Při prvním spuštění vznikne `data/luzicka.sqlite` a čtyři výchozí osoby.

## Bezpečnost

- `VIEWER_PASSWORD` dovolí pouze čtení a export.
- `ADMIN_PASSWORD` dovolí zadávání, změny nastavení a storna.
- `SESSION_SECRET` podepisuje session cookie.
- Finanční záznamy se nemažou potichu; používá se storno a auditní stopa.
- Tajemství patří pouze do Railway Variables nebo lokálního `.env`, nikdy do GitHubu.
- Repozitář může být veřejný, protože hesla ani databáze v něm nejsou. Soukromý repozitář je přesto vhodnější jako další vrstva omezení.

## Testy

```bash
npm test
```

GitHub Actions při každé změně spouští integrační testy a syntaktickou kontrolu.

## Známé hranice MVP

- účtenky a fotografie se zatím neukládají;
- aplikace neposílá upomínky ani neprovádí platby;
- přihlašování je společným heslem, nikoli samostatnými uživatelskými účty;
- změny finančních záznamů se řeší stornem a novým zápisem, ne přepisem původní částky.
