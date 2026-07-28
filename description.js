(function(){
  "use strict";

  // ---------- segmented control helper ----------
  function wireSegmented(containerId, attr, onChange){
    const el = document.getElementById(containerId);
    if(!el) return { get: () => "", set: () => {} };
    let current = el.querySelector(".segmented__opt.is-active");
    let value = current ? current.getAttribute(attr) : "";
    function activate(btn){
      el.querySelectorAll(".segmented__opt").forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      value = btn.getAttribute(attr);
      if(onChange) onChange(value);
    }
    el.addEventListener("click", (e) => {
      const btn = e.target.closest(".segmented__opt");
      if(!btn || !el.contains(btn)) return;
      activate(btn);
    });
    return {
      get: () => value,
      // Selects the option whose attr matches val, same as a user click.
      // No-ops silently if val doesn't match any option (e.g. parking=""
      // for "None", or a value the parser didn't confidently find).
      set: (val) => {
        if (val === undefined || val === null) return;
        const btn = [...el.querySelectorAll(".segmented__opt")].find(b => b.getAttribute(attr) === val);
        if (btn) activate(btn);
      },
    };
  }

  const proptypeCtl = wireSegmented("ctl-proptype", "data-proptype");
  const furnishCtl  = wireSegmented("ctl-furnish", "data-furnish");
  const parkingCtl  = wireSegmented("ctl-parking", "data-parking");

  // ---------- small text helpers ----------
  function plural(n, word){
    const num = Number(n) || 0;
    return `${num} ${word}${num === 1 ? "" : "s"}`;
  }

  function propTypeLabel(type, bedrooms){
    if(type === "studio") return "studio apartment";
    if(type === "villa") return "villa";
    if(type === "townhouse") return "townhouse";
    return "apartment";
  }

  function bedroomPhrase(type, bedrooms){
    if(type === "studio") return "studio apartment";
    return `${bedrooms}-bedroom ${propTypeLabel(type, bedrooms)}`;
  }

  // ---------- shared detail extractor (folder name + pasted text) ----------
  // Keyword/regex based — it recognizes common ways people phrase these
  // details, it doesn't "understand" the text. Always meant to pre-fill
  // the form for review, not to be trusted blind.
  const KNOWN_AREAS = [
    "The Pearl Qatar", "Pearl Qatar", "The Pearl", "West Bay", "Al Nasr", "Al Sadd",
    "Al Waab", "Al Rayyan", "Al Wakrah", "Al Duhail", "Fereej Bin Mahmoud",
    "Bin Mahmoud", "Old Airport", "Al Mansoura", "Al Messila", "Ain Khaled",
    "Al Thumama", "Muaither", "Al Gharrafa", "Al Aziziya", "Umm Ghuwailina",
    "Al Hilal", "Madinat Khalifa", "Al Markhiya", "Al Dafna", "Onaiza",
    "Umm Salal", "Al Khor", "Mesaimeer", "Abu Hamour", "New Salata",
    "Al Sailiya", "Al Ghanim", "Al Kheesa", "Al Wukair", "Rawdat Al Khail",
    "Barwa City", "Salwa Road", "Najma", "Lusail", "Doha",
  ];

  function findKnownArea(text){
    const lower = text.toLowerCase();
    let best = null;
    for(const a of KNOWN_AREAS){
      if(lower.includes(a.toLowerCase()) && (!best || a.length > best.length)) best = a;
    }
    return best;
  }

  function extractDetails(rawText){
    const text = rawText || "";
    const found = { chk: {} };
    const matched = [];

    if(/\bstudio\b/i.test(text)){ found.proptype = "studio"; matched.push("type: studio"); }
    else if(/\bvilla\b/i.test(text)){ found.proptype = "villa"; matched.push("type: villa"); }
    else if(/\btown\s*house\b/i.test(text)){ found.proptype = "townhouse"; matched.push("type: townhouse"); }
    else if(/\b(apartment|apt|flat)\b/i.test(text)){ found.proptype = "apartment"; matched.push("type: apartment"); }

    let m = text.match(/(\d+)\s*-?\s*(?:bed(?:room)?s?|br|bhk)\b/i);
    if(m){ found.bedrooms = m[1]; matched.push(`bedrooms: ${m[1]}`); }
    else if(found.proptype === "studio"){ found.bedrooms = "0"; }

    m = text.match(/(\d+)\s*-?\s*(?:bath(?:room)?s?|ba)\b/i);
    if(m){ found.bathrooms = m[1]; matched.push(`bathrooms: ${m[1]}`); }

    if(/\bsemi\s*-?\s*furnished\b/i.test(text)){ found.furnish = "Semi-furnished"; matched.push("furnishing: semi"); }
    else if(/\bunfurnished\b/i.test(text)){ found.furnish = "Unfurnished"; matched.push("furnishing: unfurnished"); }
    else if(/\bfurnished\b/i.test(text)){ found.furnish = "Fully furnished"; matched.push("furnishing: fully furnished"); }

    m = text.match(/(?:qar|qr)\s*([\d,]{3,})/i) || text.match(/([\d,]{3,})\s*(?:qar|qr)/i);
    if(m){ found.price = `QAR ${m[1].replace(/,/g, "")}`; matched.push(`price: ${found.price}`); }

    if(/\bcovered\s*parking\b/i.test(text)){ found.parking = "Covered parking"; matched.push("parking: covered"); }
    else if(/\bopen\s*parking\b/i.test(text)){ found.parking = "Open parking"; matched.push("parking: open"); }

    m = text.match(/([A-Z][\w']*(?:\s+[A-Z][\w']*)*\s+Metro\s+Station)/);
    if(m){ found.metro = m[1].trim(); matched.push(`metro: ${found.metro}`); }

    const area = findKnownArea(text);
    if(area){ found.area = area; matched.push(`area: ${area}`); }

    m = text.match(/(?:ideal|perfect|great|suited)\s+for\s+([a-zA-Z ,&]+?)(?:[.,]|$)/i);
    if(m){ found.audience = m[1].trim(); matched.push(`ideal for: ${found.audience}`); }

    const hasIncluded = (word) => new RegExp(`\\b${word}\\b[^.]{0,25}\\bincluded\\b|\\bincluded\\b[^.]{0,25}\\b${word}\\b`, "i").test(text);
    if(/\ball\s+utilities\s+included\b/i.test(text)){
      found.chk["chk-water"] = found.chk["chk-electricity"] = found.chk["chk-internet"] = found.chk["chk-maintenance"] = true;
    } else {
      if(hasIncluded("water")) found.chk["chk-water"] = true;
      if(hasIncluded("electricity")) found.chk["chk-electricity"] = true;
      if(hasIncluded("internet")) found.chk["chk-internet"] = true;
      if(hasIncluded("maintenance")) found.chk["chk-maintenance"] = true;
    }
    if(/\bready\s+to\s+move\b/i.test(text)) found.chk["chk-ready"] = true;
    if(/\bagency\s+fee\b/i.test(text)) found.chk["chk-agencyfee"] = true;
    if(/\bmetro\b/i.test(text) && /\bwalk/i.test(text)) found.chk["chk-metro-walk"] = true;

    if(Object.keys(found.chk).length){
      matched.push("amenities: " + Object.keys(found.chk).map(id => id.replace("chk-", "")).join(", "));
    }

    return { found, matched };
  }

  function applyFoundDetails(found){
    if(found.proptype) proptypeCtl.set(found.proptype);
    if(found.furnish) furnishCtl.set(found.furnish);
    if(found.bedrooms !== undefined) document.getElementById("ctl-bedrooms").value = found.bedrooms;
    if(found.bathrooms !== undefined) document.getElementById("ctl-bathrooms").value = found.bathrooms;
    if(found.area) document.getElementById("ctl-area").value = found.area;
    if(found.audience) document.getElementById("ctl-audience").value = found.audience;
    if(found.parking !== undefined) parkingCtl.set(found.parking);
    if(found.metro) document.getElementById("ctl-metro").value = found.metro;
    if(found.price) document.getElementById("ctl-price").value = found.price;
    if(found.chk){
      Object.keys(found.chk).forEach((id) => {
        const el = document.getElementById(id);
        if(el) el.checked = true;
      });
    }
  }

  // ---------- input method toggle ----------
  const methodGroup = document.getElementById("ctl-inputmethod");
  const methodPanels = {
    manual: null,
    folder: document.getElementById("method-folder"),
    text: document.getElementById("method-text"),
  };
  if(methodGroup){
    methodGroup.addEventListener("click", (e) => {
      const btn = e.target.closest(".segmented__opt");
      if(!btn) return;
      methodGroup.querySelectorAll(".segmented__opt").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      const method = btn.dataset.method;
      Object.entries(methodPanels).forEach(([key, el]) => {
        if(el) el.hidden = key !== method;
      });
    });
  }

  // ---------- "from folder name" ----------
  const foldernameInput = document.getElementById("ctl-foldername");
  const foldernameNote = document.getElementById("foldername-note");
  const folderParseResult = document.getElementById("folder-parse-result");

  // If a folder was just picked on the Photo Editor page, offer it here
  // too, so property details can be pulled from the same folder name
  // without asking for folder access twice.
  if(foldernameInput){
    try{
      const lastFolder = localStorage.getItem("contact-sheet-last-folder-name");
      if(lastFolder){
        foldernameInput.value = lastFolder;
        foldernameNote.textContent = "Loaded from the folder you picked in Photo Editor — pick a different one below if needed.";
      }
    }catch(err){ /* localStorage unavailable — ignore, field just stays empty */ }
  }

  const pickFolderNameBtn = document.getElementById("btn-pick-folder-name");
  if(pickFolderNameBtn){
    pickFolderNameBtn.addEventListener("click", async () => {
      if(typeof window.showDirectoryPicker !== "function"){
        foldernameNote.textContent = "This browser doesn't support picking a folder here (works in Chrome/Edge) — type the name in instead.";
        return;
      }
      try{
        const handle = await window.showDirectoryPicker();
        foldernameInput.value = handle.name;
        foldernameNote.textContent = "";
      }catch(err){
        if(err && err.name === "AbortError") return;
        console.warn("Folder picker failed:", err);
        foldernameNote.textContent = "Couldn't read that folder's name — type it in instead.";
      }
    });
  }

  const parseFolderBtn = document.getElementById("btn-parse-folder");
  if(parseFolderBtn){
    parseFolderBtn.addEventListener("click", () => {
      const name = foldernameInput.value.trim();
      if(!name){ folderParseResult.textContent = "Type or pick a folder name first."; return; }
      // Turn "Al-Nasr-2BR-2BA-FullyFurnished-6500QAR" into
      // "Al Nasr 2BR 2BA Fully Furnished 6500QAR" before running the same
      // parser used for pasted text.
      const normalized = name
        .replace(/[_\-.]+/g, " ")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2");
      const { found, matched } = extractDetails(normalized);
      applyFoundDetails(found);
      folderParseResult.textContent = matched.length
        ? `Parsed — ${matched.join(" · ")}. Anything not listed here wasn't found in the folder name; fill it in below manually.`
        : "Couldn't confidently parse anything from that folder name — fill the fields below in manually.";
    });
  }

  // ---------- "paste a description" ----------
  const parseTextBtn = document.getElementById("btn-parse-text");
  if(parseTextBtn){
    parseTextBtn.addEventListener("click", () => {
      const text = document.getElementById("ctl-pastetext").value.trim();
      const resultEl = document.getElementById("text-parse-result");
      if(!text){ resultEl.textContent = "Paste some details first."; return; }
      const { found, matched } = extractDetails(text);
      applyFoundDetails(found);
      resultEl.textContent = matched.length
        ? `Parsed — ${matched.join(" · ")}. This is keyword matching, not full understanding — double-check the fields below before generating.`
        : "Couldn't confidently pull structured details out of that text — the fields below are unchanged, fill them in manually.";
    });
  }

  // ---------- generation ----------
  function generate(){
    const proptype   = proptypeCtl.get() || "apartment";
    const furnish     = furnishCtl.get() || "Fully furnished";
    const furnishLower = furnish.charAt(0).toLowerCase() + furnish.slice(1);
    const bedrooms    = document.getElementById("ctl-bedrooms").value || "0";
    const bathrooms   = document.getElementById("ctl-bathrooms").value || "0";
    const area        = document.getElementById("ctl-area").value.trim() || "the area";
    const audience    = document.getElementById("ctl-audience").value.trim() || "families and working professionals";
    const parking     = parkingCtl.get();
    const metro       = document.getElementById("ctl-metro").value.trim();
    const price       = document.getElementById("ctl-price").value.trim();
    const agency      = document.getElementById("ctl-agency").value.trim() || "Sky Blue Real Estate";
    const contact     = document.getElementById("ctl-contact").value.trim() || "+974 60003252";
    const extraRaw    = document.getElementById("ctl-extra").value;

    const isStudio = proptype === "studio";
    const unfurnished = furnish === "Unfurnished";

    const chk = id => document.getElementById(id).checked;

    const bedPhrase = bedroomPhrase(proptype, bedrooms);

    // ---- opening paragraph ----
    const opening =
      `Experience comfortable and hassle-free living in this ${furnishLower} ${bedPhrase} located in the prime residential area of ${area}. ` +
      `Ideal for ${audience}, this ${propTypeLabel(proptype, bedrooms)} offers modern interiors, quality furnishings, and a convenient location with excellent access to public transportation and everyday amenities.`;

    // ---- property features ----
    const features = [];
    features.push(`${furnish} ${bedPhrase}`);
    if(!isStudio) features.push(plural(bedrooms, "spacious bedroom"));
    features.push(plural(bathrooms, "modern bathroom"));
    if(chk("chk-hall")) features.push("Bright and spacious living hall");
    if(chk("chk-kitchen")) features.push("Fully equipped kitchen");
    if(chk("chk-quality") && !unfurnished) features.push("Quality furniture and appliances");
    if(parking) features.push(parking);

    extraRaw.split("\n").map(s => s.trim()).filter(Boolean).forEach(line => features.push(line));

    // ---- additional details ----
    const details = [];
    details.push(`Prime location in ${area}`);
    if(chk("chk-metro-walk")) details.push("Walking distance to Metro Link");
    if(metro) details.push(`Close to ${metro}`);
    if(chk("chk-electricity")) details.push("Electricity included");
    if(chk("chk-water")) details.push("Water included");
    if(chk("chk-internet")) details.push("Internet included");
    if(chk("chk-maintenance")) details.push("Maintenance included");
    if(chk("chk-maintained")) details.push("Well-maintained building");
    if(chk("chk-nearby")) details.push("Easy access to supermarkets, restaurants, schools, and major roads");
    if(chk("chk-ready")) details.push("Ready to move in");
    if(chk("chk-agencyfee")) details.push("Agency fee applicable");

    // ---- utilities clause for closing paragraph ----
    const anyUtility = chk("chk-electricity") || chk("chk-water") || chk("chk-internet") || chk("chk-maintenance");
    const utilitiesClause = anyUtility ? " with all major utilities included" : "";

    // ---- closing paragraph ----
    const closing =
      `This ${furnishLower} ${propTypeLabel(proptype, bedrooms)} offers the perfect blend of comfort, convenience, and value${utilitiesClause}, ` +
      `making it an excellent choice for modern living in ${area}.`;

    // ---- assemble ----
    const lines = [];
    lines.push(opening);
    lines.push("");
    lines.push("Property Features:");
    features.forEach(f => lines.push(`• ${f}`));
    lines.push("");
    lines.push("Additional Details:");
    details.forEach(d => lines.push(`• ${d}`));
    lines.push("");
    lines.push("Rental Price:");
    lines.push(`• ${price || "Contact for price"}`);
    lines.push("");
    lines.push(closing);
    lines.push("");
    lines.push("For more information or to schedule a viewing:");
    lines.push(agency);
    lines.push(`Call / WhatsApp: ${contact}`);

    return lines.join("\n");
  }

  // ---------- wire up buttons ----------
  const output = document.getElementById("output-text");
  const flash = document.getElementById("copy-flash");

  document.getElementById("btn-generate").addEventListener("click", () => {
    output.value = generate();
  });

  document.getElementById("btn-copy").addEventListener("click", async () => {
    if(!output.value.trim()){
      output.value = generate();
    }
    try{
      await navigator.clipboard.writeText(output.value);
      flash.textContent = "Copied!";
    }catch(err){
      output.select();
      document.execCommand("copy");
      flash.textContent = "Copied!";
    }
    flash.classList.add("is-shown");
    setTimeout(() => flash.classList.remove("is-shown"), 1600);
  });

  document.getElementById("btn-txt").addEventListener("click", () => {
    if(!output.value.trim()){
      output.value = generate();
    }
    const blob = new Blob([output.value], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const area = (document.getElementById("ctl-area").value.trim() || "listing").replace(/\s+/g, "-").toLowerCase();
    a.href = url;
    a.download = `${area}-description.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  // generate an initial draft on load so the page isn't empty
  output.value = generate();
})();
