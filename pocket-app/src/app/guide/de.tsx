/**
 * The Guide's prose in German — mirrors `./en.tsx` section for section.
 * Informal "du", standard German quantum terms; UI names in bold are the
 * German labels the app actually shows (Einstellungen → Modus → …).
 */
import type { GuideProse } from './types';
import { Ext, Label } from './parts';
import {
  BOARD_PDF_URL,
  COMPOSER_URL,
  FAMILY_URL,
  IBM_REGISTRATION_URL,
  ISSUES_URL,
  LASER_KIT_URL,
  QAMPOSER_URL,
  REPO_URL,
  TILES_3D_URL,
  cubeFamily,
  kitPdf,
} from './links';

export const guideDe: GuideProse = {
  start: ({ sectionLink }) => (
    <>
      {/* Was ist das */}
      <section className="pk-guide-sec">
        <Label>Was ist das?</Label>
        <p>
          Entangible ist ein Quantenschaltkreis-Baukasten, den du mit den Händen bedienst: echte
          Gatter-Plättchen auf einem gedruckten Brett, von einer Kamera gelesen und live simuliert.
          Diese Pocket-App ist die Version ohne Installation – alles läuft direkt hier in deinem
          Browser; kein Server, kein Konto, nichts verlässt dein Gerät. Entangible baut auf{' '}
          <Ext href={QAMPOSER_URL}>QAMPoser</Ext> auf, dem Open-Source-Quanten-Composer, und gehört
          zur <Ext href={FAMILY_URL}>Fun-with-Quantum</Ext>-Familie.
        </p>
        <p className="pk-guide-muted">
          Der Name ist ein Wortspiel: <b>entangled (verschränkt) + tangible (greifbar) = Entangible.</b>
        </p>
      </section>

      {/* So geht's */}
      <section className="pk-guide-sec">
        <Label>So geht’s</Label>
        <ol className="pk-guide-steps">
          <li>
            Druck das Kit aus (oder nimm die <a {...sectionLink('booth')}>Bildschirm-Bretter</a>).
          </li>
          <li>
            Starte die Kamera und richte sie aus 30–60 cm Abstand auf das Brett, sodass alle vier
            Eckmarker im Bild sind.
          </li>
          <li>
            Leg Plättchen – Schaltung, Ergebnisse und QASM-Code folgen live. Ein <b>●</b> und ein{' '}
            <b>⊕</b> in einer Spalte ergeben ein CNOT; ein <b>●</b> neben einem beliebigen Gatter
            macht daraus die gesteuerte Version (● + <b>H</b> = gesteuertes H, zwei <b>●</b> +{' '}
            <b>X</b> = Toffoli).
          </li>
          <li>Bau ein Bell-Paar – es gibt eine Überraschung.</li>
        </ol>
        <p>
          Keine gedruckte Matte? Dann markieren vier <b>Eckblöcke</b> das Brett, und sie dürfen{' '}
          <b>ein beliebiges Rechteck</b> aufspannen – die Kamera misst es an den Blöcken selbst.
          Unter Einstellungen → <b>Brett</b> legst du fest, was dir ein größerer Tisch bringt:{' '}
          <b>Mehr Spalten</b> (Standard) behält den Plättchenabstand und fügt Spalten hinzu;{' '}
          <b>Größere Felder</b> streckt dieselben acht Spalten auf die ganze Fläche. Leg{' '}
          <b>Qubit-Leitungsblöcke</b> an den linken Rand, und jeder davon ist eine Leitung – die
          Schaltung hat also genau so viele Qubits, wie du Blöcke hinlegst; ohne Blöcke sind es die
          klassischen fünf. <b>Messblöcke</b> kommen auf gleicher Höhe an den rechten Rand: links
          die Zustandsvorbereitung, rechts die Messung, genau wie in einem Schaltplan. Sie sind
          optional und fügen nie eine Leitung hinzu; sie zeigen der Kamera nur, wo jede endet.
        </p>
        <p className="pk-guide-muted pk-guide-tips">
          Tipps: Mit zwei Fingern zoomen; das Zahnrad öffnet die Einstellungen, darunter den
          Golf-Modus und eine Debug-Ansicht; matter Druck ist besser als glänzender; Bildschirme
          funktionieren auch als Brett. Auf einem Mac kann dein iPhone per Continuity die Kamera
          sein – wähl es unter Einstellungen → Kamera.
        </p>
      </section>

      {/* Echt ausführen */}
      <section className="pk-guide-sec">
        <Label>Auf echter Hardware</Label>
        <p>
          Etwas gebaut, das dir gefällt? Der Knopf <b>An den IBM Composer senden</b> öffnet den IBM
          Quantum Composer in einem neuen Tab, mit deiner Schaltung schon geladen (der QASM-Code
          landet zusätzlich in deiner Zwischenablage – zur Not über <b>View → Code Editor</b>{' '}
          einfügen). Um sie auf einem echten Quantencomputer laufen zu lassen, melde dich an – oder
          registrier dich kostenlos unter{' '}
          <Ext href={IBM_REGISTRATION_URL}>quantum.cloud.ibm.com/registration</Ext>. Mit einem
          kostenlosen IBM-Quantum-Konto (dem Open Plan) kannst du sie dann auf echter Hardware
          ausführen.
        </p>
        <p>
          Auf einem anderen Gerät? Der <b>QR</b>-Knopf neben dem Senden-Knopf zeigt einen Code, der
          denselben vorbereiteten Composer auf deinem Handy öffnet – scannen, und deine Schaltung
          ist da, ganz ohne Tippen.
        </p>
        <p>
          Neugierig, warum echte Quantencomputer andere Antworten liefern? Schalte in den
          Einstellungen <b>Rauschen</b> ein: Dann liegt über den Ergebnissen eine simulierte
          Rausch-Reihe, und du siehst, wie sich dieselbe Schaltung auf echter Hardware verhalten
          würde. Die Profile gehen durch vier echte IBM-Chipgenerationen – Falcon (2021), Eagle,
          Heron und Nighthawk – mit Werten aus echten Kalibrierungsdaten. So siehst du ganz
          wörtlich, wie viel besser die Hardware geworden ist.
        </p>
      </section>
    </>
  ),

  print: () => (
    <>
      {/* Das echte Kit drucken */}
      <section className="pk-guide-sec">
        <Label>Das echte Kit drucken</Label>
        <p>
          Ein PDF, 12 × A4: das Stand-Kit mit 32 Plättchen auf drei Blättern, die Brett-Matte auf
          neun. Druck mit 100 % – niemals „An Seite anpassen“ – auf mattem Papier; auf jedem Blatt
          ist ein 100-mm-Prüflineal.
        </p>
        <a
          className="pk-guide-download"
          href={kitPdf}
          download="entangible-print-kit-A4.pdf"
          target="_blank"
          rel="noopener noreferrer"
        >
          Druck-Kit herunterladen (PDF)
        </a>
        <p className="pk-guide-muted">
          Für Copyshops liegt ein Brett in voller Größe auf einem Bogen (720 × 500 mm) bei den
          Release-Downloads: <Ext href={BOARD_PDF_URL}>entangible-board-720x500.pdf</Ext>.
        </p>
      </section>

      {/* Plättchen 3D-drucken */}
      <section className="pk-guide-sec">
        <Label>Plättchen im 3D-Druck</Label>
        <p>
          Für Mehrfarbdrucker (Prusa MMU, Bambu AMS): jedes Gatter als farbige 3MF-Datei – weißer
          Körper, schwarzer Marker, Band in Gatterfarbe – als flache Plättchen (6 mm), als dicke
          Würfel (60 mm, hohl, Gatterbuchstaben auf allen vier Seiten, damit du ein Teil auch quer
          über den Tisch lesen kannst) und als <b>doppelseitige Wendeteile</b>: zwei Gatter pro
          Teil – umdrehen, und du hast das andere (aus H wird X; aus einer Rotation wird ihre
          Umkehrung). Öffne eine 3MF-Datei in deinem Slicer – jedes Teil sitzt
          schon auf seinem Filament-Slot. Nimm mattes Filament – glänzende Oberflächen spiegeln und
          stören die Erkennung.
        </p>
        <img
          className="pk-guide-render"
          src={cubeFamily}
          alt="Isometrische Darstellung der Entangible-Gatterwürfel: H, X, Y, Z, CNOT-Steuerung und -Ziel, RX(π/2), S und T"
          loading="lazy"
        />
        <p>
          Das ZIP enthält einen Ordner pro Variante – <b>tile</b>, <b>cube</b>, <b>tile-double</b>,{' '}
          <b>cube-double</b> – jeweils mit den Teilen, einer <b>plates.md</b>, die die
          Filamentfarben Slot für Slot nennt, und einer <b>mono.md</b> für den einfarbigen Druck.
          Daneben liegen in <b>print-jobs</b> fertige Druckbett-Layouts mit bis zu 8 Teilen pro
          Auftrag (Druckbett 250×220, mit Platz für den Reinigungsturm), sodass ein ganzes Kit nur
          eine Handvoll Dateien zum Öffnen, Slicen und Drucken ist.
        </p>
        <a className="pk-guide-download" href={TILES_3D_URL} target="_blank" rel="noopener noreferrer">
          3D-Plättchen herunterladen (3MF + STL, ZIP)
        </a>
        <p className="pk-guide-muted">
          Die Rotationsgatter haben fühlbare Kerben (1–4 = π/4, π/2, π, −π/2). Würfel mögen eine
          Kamera direkt von oben – durch ihre Höhe verschiebt sich die Oberseite bei steilem Winkel.
        </p>
      </section>

      {/* Nur ein Filament */}
      <section className="pk-guide-sec">
        <Label>Nur ein Filament</Label>
        <p>
          Keine MMU? Dasselbe ZIP enthält jedes Teil noch zweimal als einfache STL-Datei.{' '}
          <b>*-mono-recessed.stl</b> senkt jede farbige Fläche 0,5 mm als Farbmulde mit senkrechten
          Wänden in die Oberfläche: Druck es weiß und füll die Mulden dann mit Acrylstiften – der
          Rand drumherum sorgt für eine saubere Kante. Wirklich ausmalen musst du nur den schwarzen
          Marker; das Gattersymbol zeigt ja schon, welches Gatter es ist. <b>*-mono-raised.stl</b>{' '}
          macht es umgekehrt und lässt die Motive aus der Oberfläche herausstehen, sodass ein
          einziger Filamentwechsel auf der Akzentebene auf jedem Drucker ein zweifarbiges Teil
          ergibt. Die <b>mono.md</b> jeder Variante hat das Rezept: welche Farbe wohin gehört und
          die genaue Z-Höhe für den Farbwechsel. Die <b>print-jobs</b>-Ordner haben auch
          Mono-Druckbetten – <b>mono-recessed-batch*.3mf</b> und <b>mono-raised-batch*.3mf</b> –,
          sodass ein Filamentwechsel gleich eine ganze Platte abdeckt.
        </p>
      </section>

      {/* Schwarz-Weiß */}
      <section className="pk-guide-sec">
        <Label>Nur Schwarz und Weiß</Label>
        <p>
          Zwei Filamente und keine MMU? Dasselbe ZIP enthält das ganze Kit noch ein drittes Mal:{' '}
          <b>*-bw.3mf</b> pro Teil und <b>bw-batch*.3mf</b>-Druckbetten, jedes Teil schlicht in Weiß
          und Schwarz. Die Gatterfarben fallen alle auf das Schwarz des Markers zusammen, die
          Beschriftung im Band bleibt lesbar, weil sie aus dem Band ausgeschnitten ist und weiß
          darin steht, und für die Kamera ändert sich nichts – sie schaut nie auf Farbe. Ohne
          Akzent-Slots, nach denen man gruppieren müsste, passt das Kit direkt auf die Druckbetten:
          ein Satz Betten statt einer pro Farbgruppe. Du verlierst die Farbe als Sortierhilfe; ein
          Drucker mit zwei Extrudern oder ein AMS mit zwei Spulen reicht.
        </p>
      </section>

      {/* Eckblöcke */}
      <section className="pk-guide-sec">
        <Label>Keine Matte? Eckblöcke</Label>
        <p>
          Vier optionale Blöcke – <b>UL</b>, <b>UR</b>, <b>LL</b>, <b>LR</b> – ersetzen die
          gedruckte Brett-Matte: Jeder trägt einen der Eckmarker der Matte, sodass sie auf jedem
          Tisch der Kamera genau die vier Bezugspunkte geben, die sie erwartet. Das linke Paar
          markiert, wo die Schaltung beginnt. Die Ausrichtung zählt (ein verdrehter Block verzerrt
          das ganze Brett), deshalb sitzt der Marker sichtbar außermittig nach außen, und die
          Beschriftung steht aufrecht, wenn der Block richtig liegt. Sie kommen aus demselben
          3D-ZIP (<b>ul</b>/<b>ur</b>/<b>ll</b>/<b>lr</b>-Teile + <b>corners.md</b> mit den
          Legeregeln) und genauso aus dem Laser-Kit.
        </p>
        <p>
          Die vier Blöcke dürfen <b>ein beliebiges Rechteck</b> aufspannen – sie müssen nicht im
          Abstand der gedruckten Matte liegen. Die Kamera misst das Rechteck an den Blöcken selbst
          (der 40-mm-Marker liefert den Maßstab), ein größerer Tisch heißt also einfach ein größeres
          Brett. Was dir ein größeres Brett bringt, bestimmt die Einstellung <b>Brett</b>:{' '}
          <b>Mehr Spalten</b> (Standard) behält den Plättchenabstand und gibt dir zusätzliche
          Spalten für längere Schaltungen; <b>Größere Felder</b> streckt dieselben acht Spalten über
          den ganzen Tisch, was sich quer durch einen Raum leichter treffen lässt. Ein Brett in
          Mattengröße ignoriert den Schalter und verhält sich genau wie die gedruckte Matte. Leg{' '}
          <b>Qubit-Leitungsblöcke</b> an den linken Rand – bis zu fünf gleiche Teile zwischen UL und
          LL –, und jeder davon legt auf seiner Höhe eine Leitung fest: drei Blöcke sind eine
          Schaltung mit drei Qubits, und Gatter-Plättchen rasten an der nächsten Leitung ein. Ohne
          Leitungsblöcke sind es die klassischen fünf. Gegenüber, zwischen UR und LR, kommen die{' '}
          <b>Messblöcke</b> hin – dasselbe Teil gespiegelt, mit einem kleinen Messgerät statt dem{' '}
          <i>q</i>. Sie sind reiner Feinschliff: Eine Leitung gibt es, weil ihr linker Block da
          ist, und ein Messblock sagt nur, wo diese Leitung endet. So kann die Kamera sie als
          gerade Linie zwischen den beiden führen und deinen Plättchen folgen, auch wenn die zwei
          Blockreihen nicht ganz rechtwinklig liegen. Lässt du sie weg, ändert sich nichts; ein
          Messblock ohne Leitungsblock gegenüber wird einfach ignoriert.
        </p>
      </section>

      {/* Lasergeschnittenes Holz */}
      <section className="pk-guide-sec">
        <Label>Plättchen aus dem Laser</Label>
        <p>
          Du hast Zugang zu einem Lasercutter? Das Holz-Kit sind dieselben 60-mm-Plättchen als
          SVG-Dateien nach der üblichen Werkstatt-Konvention: reines Rot ist ein Durchschnitt (die
          Kontur), reines Schwarz eine Gravur (die dunklen Felder des Markers, das Gattersymbol,
          eine Randlinie). Sonst nichts – das blanke Holz ist das „Weiß“ des Markers, also lass die
          Markerfläche ungraviert und unbemalt. Die Plättchen kommen dicht verschachtelt auf ganzen
          Platten fürs Laserbett, dazu eine SVG pro Gatter für Einzelstücke und eine
          Text-README für die Werkstatt mit Hinweisen zu Material und Schnittfuge. Die Schnittpfade
          sind in Nenngröße gezeichnet, also stell den Fugenausgleich in der Laser-Software ein –
          oder erzeug das Kit mit --kerf neu, dann wird jede Kontur um die halbe Fugenbreite nach
          außen versetzt. Birken- oder Ahornsperrholz, matt, ohne Lack.
        </p>
        <a className="pk-guide-download" href={LASER_KIT_URL} target="_blank" rel="noopener noreferrer">
          Laser-Kit herunterladen (SVG, ZIP)
        </a>
        <p className="pk-guide-muted">
          Graviere zuerst ein einzelnes H-Plättchen und prüf, ob diese App es erkennt, bevor du das
          ganze Kit schneidest – Sperrholz ist nicht gleich Sperrholz, und auf den Kontrast kommt
          es an.
        </p>
      </section>
    </>
  ),

  play: ({ sectionLink }) => (
    <>
      {/* Quanten-Golf */}
      <section className="pk-guide-sec">
        <Label>Quanten-Golf – achtzehn Löcher</Label>
        <p>
          Stell <b>Einstellungen → Modus → Quanten-Golf</b> ein, und jedes Loch gibt dir einen
          Zustand zum Nachbauen. Achtzehn Löcher in vier Runden, und jede Runde bringt neue
          Schläger <i>und</i> eine neue Idee: <b>Leicht</b> spielt mit X, H und CX (Überlagerung,
          Bell, GHZ); <b>Mittel</b> bringt <b>Y</b> und damit Minuszeichen; <b>Schwer</b> bringt{' '}
          <b>Z</b> und <b>S</b> für imaginäre Phasen; <b>Bonus</b> bringt <b>T</b> und{' '}
          <b>gesteuertes H</b> für Achtel-Phasendrehungen und ungleiche Aufteilungen.
        </p>
        <p>
          Jedes Gatter, das du hinzufügst <i>oder</i> entfernst, zählt als Schlag – ein falsches
          Plättchen kostet dich also so viel wie ein verpatzter Schlag. Par hat zwei Schläge
          Puffer: Baust du das Loch mit den wenigsten Gattern, gibt es ein <b>EAGLE</b>, mit einem
          Gatter mehr ein <b>BIRDIE</b>. Die Leiste unten auf der Scorekarte zeigt das Ergebnis
          jedes Lochs neben seinem Par.
        </p>
        <p>
          <b>Neue Zufalls-18</b> erstellt einen frischen Platz. Die Ziele sind erzeugt, aber die
          Schwierigkeitsregeln sorgen dafür, dass jede Runde hält, was ihr Name verspricht – ein
          mittleres Loch braucht wirklich Y, ein Bonus-Loch wirklich T oder gesteuertes H. Jeder
          Zufallsplatz hat einen Code (<b>Platz #…</b>): Tipp darauf, um einen Link zu kopieren,
          oder gib einen Code unter <b>Einstellungen → Golfplatz-Code</b> ein. Derselbe Code ergibt
          auf jedem Handy dieselben achtzehn Löcher – tritt gegen Freundinnen und Freunde an.
        </p>
        <p>
          Du hängst fest? <b>Lösung zeigen</b> zeichnet eine kurze Schaltung, die das Ziel baut. Den
          Knopf gibt es, sobald du eingelocht hast, und auch mitten im Loch, wenn du ein paar
          Schläge über Par oder schon eine Minute dabei bist. Im Hintergrund sucht die App nach
          etwas Kürzerem: Findet sie etwas, zeichnet sie es auch, und kann sie beweisen, dass es
          nichts Kürzeres gibt, beschriftet sie die Zeichnung mit <b>Lösung – optimal</b>.
        </p>
        <p className="pk-guide-muted">
          Die Kugel sagt, was sie ist – eine <b>Bloch-Kugel</b> bei Löchern mit einem Qubit, sonst
          eine <b>Q-Kugel</b>. Sie startet immer mit |0…0⟩ oben; zieh, um sie zu drehen (sie folgt
          deinem Finger), und der Zurück-Pfeil stellt sie wieder gerade. Das Ziel ist als
          gestrichelte Ringe mit Phasenmarken eingezeichnet, und die wichtigen Zustände tragen ihr
          Ket. Kugeln aus Wahrscheinlichkeit rollen über die Oberfläche, während deine Schaltung
          abläuft, und teilen sich, wenn ein Gatter eine Überlagerung erzeugt (<b>↻</b> spielt es
          noch mal ab). Darunter schreiben die Zeilen <b>Zustand</b> und <b>Ziel</b> dasselbe als
          Formel, und Zielterme, die du noch nicht getroffen hast, leuchten.
        </p>
        <p className="pk-guide-muted">
          Keine gedruckten Plättchen zur Hand? Golf geht genauso gut{' '}
          <a {...sectionLink('build')}>am Bildschirm</a>.
        </p>
      </section>

      {/* Quantina */}
      <section className="pk-guide-sec">
        <Label>Quantina – eine Quanten-Kantine</Label>
        <p>
          Der eingebaute Nachfolger von Qoffee-Maker und quantum-mixer: Stell{' '}
          <b>Einstellungen → Modus → Quantina</b> ein, und das Histogramm wird zur Speisekarte –
          die Wahrscheinlichkeiten deiner Schaltung bestimmen die Chancen, eine Messung wählt dein
          Getränk. Probier{' '}
          <a href="/?menu=cocktails&amp;lang=de">entangible.org/?menu=cocktails</a>: Ein H pro
          Leitung macht jeden Cocktail gleich wahrscheinlich; verschränk zwei Qubits und sieh zu,
          wie Getränke plötzlich gemeinsam gewinnen.
        </p>
        <p className="pk-guide-muted">
          Fünf Menüs sind eingebaut (Kaffee, Cocktails, Eis, Saft, Diner). Stände können eigene
          Menüs hinzufügen – und das Gewinner-Ergebnis sogar an eine echte Kaffeemaschine
          schicken –, siehe die Doku im Repository.
        </p>
      </section>

      {/* Quantum Runner */}
      <section className="pk-guide-sec">
        <Label>Quantum Runner – weich der Messung aus</Label>
        <p>
          Stell <b>Einstellungen → Modus → Quantum Runner</b> ein für ein Spiel im Flappy-Stil, bei
          dem der Läufer in jedem Basiszustand gleichzeitig existiert – der Geist auf jeder Bahn
          ist so deutlich wie seine Wahrscheinlichkeit. Tipp auf die Gatter-Knöpfe, um den
          Zustand umzuformen, während Münzen und Hindernisse heranrollen. Münzen bringen den{' '}
          <i>Erwartungswert</i> (es wird nie gemessen, eine Überlagerung sammelt also Bruchteile);
          ein rotes Hindernis löst eine echte projektive Messung aus – kollabierst du hinein,
          verlierst du ein Leben. In Level 2 kann ein Hindernis, das <b>|01⟩</b> und <b>|10⟩</b>{' '}
          überspannt, den Bell-Zustand Φ⁺ (H₀, dann CX) nicht berühren – bau ihn und flieg einfach
          durch.
        </p>
        <p className="pk-guide-muted">
          Nach Quantum Runner aus dem QAMPoser-Projekt. Keine Hardware nötig – es läuft komplett am
          Bildschirm.
        </p>
      </section>
    </>
  ),

  build: ({ sectionLink }) => (
    <section className="pk-guide-sec">
      <Label>Am Bildschirm bauen – ohne Drucker, ohne Kamera</Label>
      <p>
        Wähl <b>Am Bildschirm</b> (Einstellungen → Eingabe, oder den Knopf auf dem Startbildschirm),
        um Gatter direkt im Editor zu setzen – spiel{' '}
        <a {...sectionLink('play')}>Quanten-Golf</a> und schick deine Schaltung an den Composer,
        ganz ohne Hardware. Im Golf gibt dir die Gatter-Leiste nur die Schläger der aktuellen
        Runde; außerhalb vom Golf bekommst du alle Gatter.
      </p>
      <p>
        Auf einem Touchscreen musst du nicht ziehen: <b>Tipp ein Gatter-Plättchen an, um es
        auszuwählen</b>, und tipp dann auf eine Leitung, um es dort abzulegen. Bei einem gesteuerten
        Gatter tippst du zuerst die <b>Steuer</b>-Leitung und dann das <b>Ziel</b> an (bei einem
        Toffoli: zwei Steuerleitungen, dann das Ziel) – eine Zeile über der Schaltung sagt dir,
        welcher Tipp als Nächstes kommt. Nochmal auf das gewählte Plättchen tippen oder Escape
        drücken bricht ab. Tipp auf ein Gatter, das schon auf einer Leitung liegt, für seine kleine
        Werkzeugleiste: Der Stift bearbeitet es (Drehwinkel und die Leitungen eines gesteuerten
        Gatters), der Mülleimer löscht es. Ziehen geht überall trotzdem.
      </p>
      <p className="pk-guide-muted">
        Einen Bildschirm übrig, aber keinen Drucker? Mit den{' '}
        <a {...sectionLink('booth')}>Test-Brettern am Bildschirm</a> spielt ein zweites Gerät die
        Rolle der gedruckten Matte.
      </p>
    </section>
  ),

  booth: ({ sectionLink, testBoards, family }) => (
    <>
      {/* Ohne Drucker testen */}
      <section className="pk-guide-sec">
        <Label>Testen ohne Drucker</Label>
        {testBoards}
        <p className="pk-guide-muted">
          Zeig sie im Vollbild auf einem Gerät und richte die Kamera eines anderen darauf. Blättere
          durch die Bilder, um Plättchen zu „bewegen“. Kein Drucker <i>und</i> keine Kamera? Bau
          die Schaltung stattdessen <a {...sectionLink('build')}>am Bildschirm</a>.
        </p>
      </section>

      {/* Das ganze Projekt */}
      <section className="pk-guide-sec">
        <Label>Das ganze Projekt</Label>
        <p>
          Dieselbe App betreibt auch den kompletten Messestand: Ein Raspberry-Pi-Kiosk (RasQberry)
          zeigt sie im Kiosk-Modus auf einem großen Bildschirm, eine Live-Kamera oder ein Handy vom
          Team liefert das Bild, und es gibt Feuerwerk, sobald Verschränkung entsteht – gebaut für
          Messen und Veranstaltungen. Eine App, dieselben Plättchen, dasselbe Brett, dieselbe
          Technik.
        </p>
        <p>
          Am Stand scannst du den <b>Besucher-QR</b> auf dem großen Bildschirm, um auf deinem
          eigenen Handy mitzuschauen – du siehst live, wie auf dem Tisch die Schaltung entsteht,
          und kannst sie mit dem Senden-Knopf mit nach Hause nehmen.
        </p>
        <p>
          Stand-Tische haben selten Mattengröße, deshalb legt das Team die Eckblöcke auf das
          Rechteck, das der Tisch hergibt, und stellt <b>Brett</b> einmal über die
          Bedienelemente ein; die Wahl wird übertragen, sodass jeder Bildschirm im Raum den Tisch
          gleich liest. Qubit-Leitungsblöcke am linken Rand legen fest, mit wie vielen Qubits das
          Brett spielt – praktisch für eine kurze Demo auf zwei oder drei Leitungen –, und die
          passenden Messblöcke am rechten Rand lassen den Tisch von Anfang bis Ende wie einen
          Schaltplan aussehen. Sie sind optional; auf einem Tisch, der nicht ganz rechtwinklig ist,
          helfen sie der Kamera außerdem, jede Leitung von ihrem Block bis zu ihrer Messung zu
          verfolgen, damit Plättchen auf der Zeile bleiben, die du gemeint hast.
        </p>
        <ul className="pk-guide-links">
          <li>
            <Ext href={REPO_URL}>GitHub-Repository</Ext>
          </li>
          <li>
            <Ext href={ISSUES_URL}>Problem melden</Ext>
          </li>
        </ul>
      </section>

      {/* Familie */}
      <section className="pk-guide-sec">
        <Label>Teil der Fun-with-Quantum-Familie</Label>
        <p>
          Entangible gehört zu{' '}
          <Ext href={FAMILY_URL}>
            <b>Fun with Quantum</b>
          </Ext>
          , einer Familie von Open-Source-Projekten, die Quantencomputing zugänglich machen:{' '}
          {family}.
        </p>
      </section>
    </>
  ),

  footer: () => (
    <>
      <p>
        Open Source, Apache-2.0-lizenziert. Basiert auf <Ext href={QAMPOSER_URL}>QAMPoser</Ext>.
        Teil der <Ext href={FAMILY_URL}>Fun-with-Quantum-Familie</Ext>.
      </p>
      <p>
        Entangible ist ein unabhängiges Community-Projekt, inspiriert vom{' '}
        <Ext href={COMPOSER_URL}>IBM Quantum Composer</Ext>. Es ist nicht mit IBM verbunden und
        wird von IBM weder unterstützt noch gesponsert. IBM, IBM Quantum und Qiskit sind Marken der
        International Business Machines Corporation.
      </p>
    </>
  ),
};
