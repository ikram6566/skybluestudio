(function(){
  "use strict";

  // ---------- segmented control helper ----------
  function wireSegmented(containerId, attr, onChange){
    const el = document.getElementById(containerId);
    if(!el) return { get: () => "" };
    let current = el.querySelector(".segmented__opt.is-active");
    let value = current ? current.getAttribute(attr) : "";
    el.addEventListener("click", (e) => {
      const btn = e.target.closest(".segmented__opt");
      if(!btn || !el.contains(btn)) return;
      el.querySelectorAll(".segmented__opt").forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      value = btn.getAttribute(attr);
      if(onChange) onChange(value);
    });
    return { get: () => value };
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
