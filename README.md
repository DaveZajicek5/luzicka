# Lužická — účet domácnosti

Lokální webová aplikace pro transparentní rozúčtování nájmu, energií, služeb domu a společných nákupů mezi obyvateli bytu.

## Co umí první verze

- měsíční dashboard s předpisem, přijatými platbami a zůstatkem každé osoby;
- nájemné, služby domu, internet, zálohy na elektřinu a plyn;
- roční vyúčtování včetně záporných položek (vratky/přeplatky);
- ad hoc společné nákupy;
- výchozí váhy osob a výběr, koho se konkrétní položka týká;
- pravidelné šablony a idempotentní vygenerování měsíce;
- odečty elektroměru a plynoměru;
- CSV export pro Excel a tiskovou stránku pro PDF;
- stornování místo mazání a administrátorský audit změn;
- oddělený čtenářský a administrátorský přístup;
- volitelné omezení pouze na privátní lokální síť.

Konkrétní rozdělení každého nákladu se uloží v haléřích. Pozdější změna jména, aktivity nebo váhy osoby tedy nepřepíše historii.

## Spuštění

Vyžaduje **Node.js 22.5+**. Aplikace nemá žádné balíčkové závislosti.

```bash
cp .env.example .env
# upravte hesla a SESSION_SECRET
npm start
```

Otevřete `http://127.0.0.1:8787`.

Při prvním spuštění vznikne `data/luzicka.sqlite` a čtyři výchozí osoby. Jejich jména a podíly upravte ve **Správě**.

## Přístup z domácí Wi-Fi

V `.env` nastavte:

```dotenv
HOST=0.0.0.0
LAN_ONLY=true
```

Na počítači zjistěte jeho lokální IP adresu a na telefonu otevřete například `http://192.168.1.50:8787`. Může být nutné povolit port 8787 v lokálním firewallu.

**Na routeru nezapínejte port forwarding.** `LAN_ONLY=true` navíc odmítá veřejné zdrojové IP adresy, ale nenahrazuje správně nastavený router/firewall.

## Hesla

- `VIEWER_PASSWORD` dovolí pouze čtení a export.
- `ADMIN_PASSWORD` dovolí zadávání, změny nastavení a storna.
- `SESSION_SECRET` podepisuje přihlašovací cookie.

Hesla patří pouze do `.env`, který je v `.gitignore`. Požadované čtenářské heslo nastavte lokálně jako `VIEWER_PASSWORD`; do veřejného repozitáře ho neukládejte. Administrátorské heslo musí být jiné a výrazně silnější.

Doporučené vytvoření tajemství:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
chmod 600 .env
```

## Záloha

Při vypnuté aplikaci zkopírujte soubor `data/luzicka.sqlite` na bezpečné místo. Pro automatizaci lze pravidelně kopírovat celý adresář `data/`.

## Testy

```bash
npm test
```

## Známé hranice MVP

- účtenky/fotografie se zatím neukládají;
- aplikace neposílá upomínky ani platby;
- HTTPS není součástí vestavěného serveru — pro čistě domácí LAN je přístup přes HTTP nejjednodušší, pro vzdálený přístup se tato verze nemá vystavovat internetu;
- změny finančních záznamů se řeší stornem a novým zápisem, ne přepisem původní částky.
