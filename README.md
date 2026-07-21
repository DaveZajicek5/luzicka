# Lužická — účet domácnosti

Soukromá webová aplikace pro transparentní rozúčtování nájmu, energií, služeb domu a společných nákupů mezi obyvateli bytu.

## Co umí

- měsíční dashboard s předpisem, přijatými platbami a zůstatkem každé osoby;
- nájemné, služby domu, internet, zálohy na elektřinu a plyn;
- roční vyúčtování včetně záporných položek (vratky/přeplatky);
- ad hoc společné nákupy;
- výchozí váhy osob a výběr, koho se konkrétní položka týká;
- pravidelné šablony a idempotentní vygenerování měsíce;
- odečty elektroměru a plynoměru;
- CSV export pro Excel a tiskovou stránku pro PDF;
- storna místo mazání a administrátorskou auditní stopu;
- oddělený čtenářský a administrátorský přístup.

Konkrétní rozdělení každého nákladu se ukládá v haléřích. Pozdější změna jména, aktivity nebo váhy osoby tedy nepřepíše historii.

## Doporučené nasazení: starý MacBook + Tailscale

Kompletní návod je v **[SERVER_SETUP.md](SERVER_SETUP.md)**. Po instalaci Debianu se celý server nastaví jediným příkazem:

```bash
curl -fsSL https://raw.githubusercontent.com/DaveZajicek5/luzicka/main/ops/bootstrap.sh | sudo bash
```

Výsledné řešení:

- nevyžaduje placený hosting ani veřejně otevřený port;
- je dostupné z telefonů pouze pozvaným členům Tailscale;
- automaticky restartuje aplikaci a VPN;
- každých deset minut kontroluje nový kód na `main`;
- před aktualizací zálohuje databázi, spouští testy a při problému provede rollback;
- vytváří noční SQLite zálohy a provádí bezpečnostní aktualizace Debianu;
- zakazuje uspávání, reakci na zavření víka a Wi-Fi power saving.

## Lokální spuštění pro vývoj

Vyžaduje **Node.js 22.9+**. Aplikace nemá žádné balíčkové závislosti.

```bash
cp .env.example .env
# upravte hesla a SESSION_SECRET
npm start
```

Otevřete `http://127.0.0.1:8787`. Při prvním spuštění vznikne `data/luzicka.sqlite` a čtyři výchozí osoby.

## Volitelné cloudové nasazení

Repozitář stále obsahuje `railway.json` a podporu Railway, ale pro domácí použití je doporučený vlastní MacBook server bez měsíčního poplatku. Při cloudovém nasazení je nutné připojit persistentní Volume na `/data` a nastavit `VIEWER_PASSWORD`, `ADMIN_PASSWORD` a `SESSION_SECRET` jako tajné proměnné služby.

## Bezpečnost

- `VIEWER_PASSWORD` dovolí pouze čtení a export.
- `ADMIN_PASSWORD` dovolí zadávání, změny nastavení a storna.
- `SESSION_SECRET` podepisuje session cookie.
- Finanční záznamy se nemažou potichu; používá se storno a auditní stopa.
- Tajemství a databáze nikdy nepatří do GitHubu.
- Produkční kontejner poslouchá pouze na `127.0.0.1`; HTTPS přístup zajišťuje privátní Tailscale Serve.

## Testy

```bash
npm test
```

GitHub Actions při každé změně spouští integrační testy, syntaktickou kontrolu shellových i JavaScript souborů a sestavení produkčního kontejneru.

## Známé hranice MVP

- účtenky a fotografie se zatím neukládají;
- aplikace neposílá upomínky ani neprovádí platby;
- přihlašování je společným heslem, nikoli samostatnými aplikačními účty;
- změny finančních záznamů se řeší stornem a novým zápisem, ne přepisem původní částky;
- lokální zálohy nejsou náhradou za budoucí off-site zálohu.
