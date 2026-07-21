# MacBook Air jako domácí server

Tento postup smaže celý MacBook a nainstaluje Debian 13. Aplikace bude dostupná jen členům soukromé sítě Tailscale, nikoli veřejně z internetu.

## Co si připravit

- MacBook Air Intel (přibližně 2015) a nabíječku;
- USB flash disk alespoň 2 GB, jehož obsah může být smazán;
- dočasné připojení k internetu po instalaci: nejjistější je USB–Ethernet adaptér; lze zkusit i USB tethering z telefonu;
- přihlašovací účet Google, Apple, Microsoft nebo GitHub pro Tailscale.

Interní Wi-Fi tohoto MacBooku bývá Broadcom BCM4360. Debian ji může během instalace nevidět; bootstrap ovladač nainstaluje, ale k tomu potřebuje jednorázově internet jinou cestou.

## 1. Než smažete macOS

Zkopírujte vše, co chcete zachovat. V Terminálu můžete ještě zkusit uložit do nastavení Intel Macu automatický restart po výpadku napájení:

```bash
sudo pmset -a autorestart 1 autorestartatconnect 1
```

Podpora se liší podle konkrétního modelu; krátké výpadky každopádně překlene baterie.

## 2. Vytvořte instalační USB

1. Z oficiálního webu Debianu stáhněte **Debian 13 amd64 netinst ISO**: <https://www.debian.org/download>
2. Stáhněte balenaEtcher pro Intel Mac: <https://etcher.balena.io/>
3. V Etcheru zvolte `Flash from file`, vyberte Debian ISO, vyberte USB a stiskněte `Flash`.
4. USB bude kompletně smazáno.

## 3. Spusťte instalátor

1. Nechte USB připojené a MacBook vypněte.
2. Zapněte jej a okamžitě držte klávesu **Option (⌥ / Alt)**.
3. Vyberte **EFI Boot**.
4. Zvolte **Graphical install**.

Doporučené volby v instalátoru:

- jazyk a klávesnice: podle preference;
- hostname: `luzicka`;
- domain name: nechte prázdné;
- heslo uživatele root: nechte prázdné, aby první běžný uživatel dostal `sudo`;
- vytvořte si běžného uživatele a zapamatujte si jeho heslo;
- partitioning: **Guided – use entire disk** → **All files in one partition** → potvrdit zápis změn;
- software selection: ponechte pouze **SSH server** a **standard system utilities**; desktop environment není potřeba;
- instalaci GRUB potvrďte na interní disk.

Pokud instalátor interní Wi-Fi nenajde, je to u tohoto modelu očekávatelné. Zvolte pokračování bez sítě. Po prvním startu připojte USB–Ethernet adaptér nebo USB tethering z telefonu.

## 4. Spusťte automatické nastavení

Po prvním startu se přihlaste vytvořeným uživatelem. Ověřte internet například:

```bash
ping -c 3 debian.org
```

Potom vložte jediný příkaz:

```bash
curl -fsSL https://raw.githubusercontent.com/DaveZajicek5/luzicka/main/ops/bootstrap.sh | sudo bash
```

Skript automaticky:

- nainstaluje Broadcom Wi-Fi ovladač, NetworkManager, Docker a Tailscale;
- nabídne připojení k domácí Wi-Fi;
- zakáže uspávání, reakci na zavření víka a Wi-Fi power saving;
- nainstaluje Lužickou a vytvoří náhodné administrátorské heslo;
- nastaví restart aplikace, watchdog, automatické aktualizace s rollbackem a noční zálohy;
- nastaví bezpečnou HTTPS adresu dostupnou pouze v Tailscale.

Tailscale během běhu vypíše přihlašovací URL. Otevřete ji na telefonu a přihlášení potvrďte. Totéž může jednorázově nastat při zapnutí HTTPS přes Tailscale Serve.

## 5. Poslední dva klikací kroky

1. V Tailscale admin konzoli otevřete **Machines → luzicka → … → Disable key expiry**. Jinak by server po výchozí době vyžadoval nové přihlášení.
2. Nainstalujte Tailscale na telefony spolubydlících a v **Users → Invite external users** jim pošlete pozvánku. Bezplatný Personal plán pojme až šest uživatelů.

Po přijetí pozvánky otevřou všichni HTTPS adresu, kterou instalátor vypsal. Viewer heslo je `97E690DC`; administrátorské heslo je pouze na serveru v:

```text
/root/luzicka-credentials.txt
```

Zobrazíte ho příkazem:

```bash
sudo cat /root/luzicka-credentials.txt
```

## Provoz

MacBook nechte na nabíječce a na tvrdém větraném povrchu. Po prvním úspěšném restartu lze víko zavřít. Kabelové připojení je stabilnější, Wi-Fi je ale nakonfigurovaná bez úsporného režimu.

Souhrnná diagnostika:

```bash
sudo bash /opt/luzicka/ops/status.sh
```

Ruční okamžitá záloha:

```bash
sudo bash /opt/luzicka/ops/backup.sh manual
```

Lokální zálohy chrání proti chybné aktualizaci nebo poškození databáze, ne proti fyzickému selhání nebo krádeži celého MacBooku. Off-site zálohu lze doplnit později.
