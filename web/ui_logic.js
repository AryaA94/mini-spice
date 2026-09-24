/* ====================== UI state ====================== */
const TRACE_COLORS=["#1f77b4","#d62728","#2ca02c","#d97706","#7c3aed","#0891b2"];
let rows=[];
let mode="dc";

const PRESETS={
  "Voltage divider": [
    {type:"V",name:"V1",nodeA:"in",nodeB:"0",dcValue:10},
    {type:"R",name:"R1",nodeA:"in",nodeB:"out",value:1000},
    {type:"R",name:"R2",nodeA:"out",nodeB:"0",value:1000},
  ],
  "RC step": [
    {type:"V",name:"V1",nodeA:"in",nodeB:"0",dcValue:5},
    {type:"R",name:"R1",nodeA:"in",nodeB:"out",value:1000},
    {type:"C",name:"C1",nodeA:"out",nodeB:"0",value:1e-6,ic:0},
  ],
  "RLC underdamped": [
    {type:"V",name:"V1",nodeA:"in",nodeB:"0",dcValue:5},
    {type:"R",name:"R1",nodeA:"in",nodeB:"a",value:50},
    {type:"L",name:"L1",nodeA:"a",nodeB:"out",value:0.01,ic:0},
    {type:"C",name:"C1",nodeA:"out",nodeB:"0",value:1e-6,ic:0},
  ],
  "RC low-pass (AC)": [
    {type:"V",name:"V1",nodeA:"in",nodeB:"0",dcValue:0,acMag:1,acPhase:0},
    {type:"R",name:"R1",nodeA:"in",nodeB:"out",value:1000},
    {type:"C",name:"C1",nodeA:"out",nodeB:"0",value:1e-7},
  ],
  "Wheatstone bridge": [
    {type:"V",name:"V1",nodeA:"top",nodeB:"0",dcValue:9},
    {type:"R",name:"R1",nodeA:"top",nodeB:"a",value:1000},
    {type:"R",name:"R2",nodeA:"a",nodeB:"0",value:2000},
    {type:"R",name:"R3",nodeA:"top",nodeB:"b",value:2000},
    {type:"R",name:"R4",nodeA:"b",nodeB:"0",value:4000},
    {type:"R",name:"Rg",nodeA:"a",nodeB:"b",value:500},
  ],
  "Diode clipper": [
    {type:"V",name:"V1",nodeA:"in",nodeB:"0",dcValue:5},
    {type:"R",name:"R1",nodeA:"in",nodeB:"a",value:1000},
    {type:"D",name:"D1",nodeA:"a",nodeB:"0"},
  ],
  "BJT fixed-bias": [
    {type:"V",name:"VBB",nodeA:"base",nodeB:"0",dcValue:5},
    {type:"R",name:"RB",nodeA:"base",nodeB:"b1",value:100000},
    {type:"V",name:"VCC",nodeA:"vcc",nodeB:"0",dcValue:10},
    {type:"R",name:"RC",nodeA:"vcc",nodeB:"col",value:1000},
    {type:"Q",name:"Q1",nodeA:"col",nodeB:"b1",nodeC:"0",is:1e-16,bf:100,br:1},
  ],
  "PNP fixed-bias": [
    {type:"V",name:"VBB",nodeA:"base",nodeB:"0",dcValue:-5},
    {type:"R",name:"RB",nodeA:"base",nodeB:"b1",value:100000},
    {type:"V",name:"VCC",nodeA:"vcc",nodeB:"0",dcValue:-10},
    {type:"R",name:"RC",nodeA:"vcc",nodeB:"col",value:1000},
    {type:"Q",name:"Q1",nodeA:"col",nodeB:"b1",nodeC:"0",is:1e-16,bf:100,br:1,pnp:true},
  ],
  "VCVS amplifier": [
    {type:"V",name:"V1",nodeA:"in",nodeB:"0",dcValue:2},
    {type:"E",name:"E1",nodeA:"out",nodeB:"0",nodeC:"in",nodeD:"0",value:3},
    {type:"R",name:"Rload",nodeA:"out",nodeB:"0",value:1000},
  ],
  "VCCS transconductance": [
    {type:"V",name:"V1",nodeA:"in",nodeB:"0",dcValue:2},
    {type:"G",name:"G1",nodeA:"out",nodeB:"0",nodeC:"in",nodeD:"0",value:0.005},
    {type:"R",name:"Rload",nodeA:"out",nodeB:"0",value:2000},
  ],
  // examples/12_pulse_rc_filter: PULSE(0 5 1m 0.1m 0.1m 2m 4m), no DC value
  "PULSE into RC filter": [
    {type:"V",name:"V1",nodeA:"in",nodeB:"0",waveform:{kind:"PULSE",params:[0,5,1e-3,1e-4,1e-4,2e-3,4e-3]}},
    {type:"R",name:"R1",nodeA:"in",nodeB:"out",value:1000},
    {type:"C",name:"C1",nodeA:"out",nodeB:"0",value:1e-6},
  ],
  // examples/13_sine_source: SIN(1 2 500 0 0), no DC value
  "SIN into RC filter": [
    {type:"V",name:"V1",nodeA:"in",nodeB:"0",waveform:{kind:"SIN",params:[1,2,500,0,0]}},
    {type:"R",name:"R1",nodeA:"in",nodeB:"out",value:1000},
    {type:"C",name:"C1",nodeA:"out",nodeB:"0",value:1e-7},
  ],
};

// Presets that only make sense as a transient run also switch the analysis
// tab and set dt/stop, so hitting Run shows the waveform straight away.
// Values match the committed examples/12_*/ and 13_*/transient.csv.
const PRESET_ANALYSIS={
  "PULSE into RC filter": {mode:"tran", dt:"2e-5", stop:"10e-3"},
  "SIN into RC filter":   {mode:"tran", dt:"2e-5", stop:"6e-3"},
};

const NAME_EXAMPLE={R:"R1",C:"C1",L:"L1",V:"V1",I:"I1",D:"D1",Q:"Q1",E:"E1",G:"G1"};

/* ---- transient waveforms (PULSE/SIN) on V/I sources ----
   Parameter order is the netlist's: PULSE(V1 V2 TD TR TF PW PER) and
   SIN(VO VA FREQ TD THETA) -- see docs/SUPPORTED_COMPONENTS.md and
   DESIGN_DECISIONS.md #17. The form never invents its own semantics:
   `required` params must be typed in; every other param left blank is
   written into the netlist as an explicit 0, which the engine defines
   exactly (0 rise/fall = an instant edge, PER 0 = TR+PW+TF, SIN TD/THETA 0
   = no delay/damping). Note that real SPICE's defaults for a *missing*
   TR/TF/PW/PER are tied to the .tran step/stop instead -- this engine's
   parser requires all 7 PULSE values precisely so that's never ambiguous,
   and writing explicit 0s keeps it that way. `nonneg` mirrors the parser's
   own "negative TR/TF/PW/PER" rejection, caught here at add time instead
   of at run time. `unit` is "v" for a level (V or A, depending on the
   source type), "s" for a time, and a literal string otherwise. */
const WAVEFORM_PARAMS={
  PULSE:[
    {key:"V1",  label:"V1 initial",  unit:"v", required:true},
    {key:"V2",  label:"V2 pulsed",   unit:"v", required:true},
    {key:"TD",  label:"TD delay",    unit:"s"},
    {key:"TR",  label:"TR rise",     unit:"s", nonneg:true},
    {key:"TF",  label:"TF fall",     unit:"s", nonneg:true},
    {key:"PW",  label:"PW width",    unit:"s", nonneg:true},
    {key:"PER", label:"PER period",  unit:"s", nonneg:true},
  ],
  SIN:[
    {key:"VO",    label:"VO offset",    unit:"v", required:true},
    {key:"VA",    label:"VA amplitude", unit:"v", required:true},
    {key:"FREQ",  label:"FREQ",         unit:"Hz", required:true},
    {key:"TD",    label:"TD delay",     unit:"s"},
    {key:"THETA", label:"THETA damping", unit:"1/s"},
  ],
};
const WAVEFORM_HINT={
  PULSE:"Blank timing fields are 0. TR/TF 0 = instant edge; PER 0 = repeat right after the fall (TR+PW+TF). Blank DC value = V1 for the DC operating point.",
  SIN:"VO + VA·e^(−THETA·(t−TD))·sin(2π·FREQ·(t−TD)) for t ≥ TD, VO before. Blank TD/THETA are 0. Blank DC value = VO for the DC operating point.",
};
function waveformUnit(p, type){ return p.unit==="v" ? (type==="I"?"A":"V") : p.unit; }
// The value the DC operating point uses when no explicit DC value was given
// -- same rule as Waveform::rest_value() in component.hpp.
function waveformRestValue(wf){ return wf.params[0]; }
function waveformClause(wf){ return `${wf.kind}(${wf.params.join(" ")})`; }
function fmtWaveform(wf){ return `${wf.kind}(${wf.params.map(fmtValue).join(" ")})`; }

/* ---- value parsing (client-side validation/formatting only; the real
   solve happens in WASM, which re-parses the numeric netlist text itself) ---- */
function parseValue(token){
  const m=String(token).trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(.*)$/);
  if(!m) throw new Error("not a valid number: '"+token+"'");
  const mant=parseFloat(m[1]); const suf=m[2].trim().toLowerCase();
  let mult=1;
  if(suf.startsWith("meg")) mult=1e6;
  else if(suf.length>0){ const t={t:1e12,g:1e9,k:1e3,m:1e-3,u:1e-6,n:1e-9,p:1e-12,f:1e-15}; mult=(t[suf[0]]!==undefined)?t[suf[0]]:1; }
  return mant*mult;
}

function fmtValue(v){
  if (v===0) return "0";
  const a=Math.abs(v);
  if (a>=1e6 || a<1e-6) return v.toExponential(3);
  return parseFloat(v.toPrecision(5)).toString();
}
function fmtRowValue(r){
  if(r.type==="V"||r.type==="I"){
    // With a waveform and no explicit DC value, show the value the DC
    // operating point actually uses (the waveform's rest value).
    const dc = r.dcValue!==undefined ? r.dcValue : waveformRestValue(r.waveform);
    return fmtValue(dc)+(r.type==="V"?"V":"A");
  }
  if(r.type==="D") return "IS="+fmtValue(r.is!==undefined?r.is:1e-14)+"A";
  if(r.type==="Q") return "IS="+fmtValue(r.is!==undefined?r.is:1e-16)+"A";
  if(r.type==="E"||r.type==="G") return fmtValue(r.value);
  const unit=r.type==="R"?"\u03a9":r.type==="C"?"F":"H";
  return fmtValue(r.value)+unit;
}
function fmtRowExtra(r){
  if(r.type==="C"||r.type==="L") return (r.ic? "IC="+fmtValue(r.ic):"");
  if(r.type==="V"||r.type==="I"){
    const parts=[];
    if(r.waveform) parts.push(fmtWaveform(r.waveform));
    if(r.acMag) parts.push("AC "+fmtValue(r.acMag)+"\u2220"+fmtValue(r.acPhase||0)+"\u00b0");
    return parts.join(" ");
  }
  if(r.type==="D") return "N="+fmtValue(r.n!==undefined?r.n:1.0);
  if(r.type==="Q") return (r.pnp?"PNP ":"")+"BF="+fmtValue(r.bf!==undefined?r.bf:100)+" BR="+fmtValue(r.br!==undefined?r.br:1);
  return "";
}

/* ---- rows -> real .cir netlist text (same format the CLI/tests use) ---- */
function rowsToNetlist(rows){
  return rows.map(r=>{
    if(r.type==="R"||r.type==="C"||r.type==="L"){
      let line=`${r.name} ${r.nodeA} ${r.nodeB} ${r.value}`;
      if((r.type==="C"||r.type==="L") && r.ic) line+=` IC=${r.ic}`;
      return line;
    }
    if(r.type==="D"){
      let line=`${r.name} ${r.nodeA} ${r.nodeB}`;
      if(r.is!==undefined) line+=` IS=${r.is}`;
      if(r.n!==undefined) line+=` N=${r.n}`;
      return line;
    }
    if(r.type==="Q"){
      // SPICE node order: collector base emitter
      let line=`${r.name} ${r.nodeA} ${r.nodeB} ${r.nodeC}`;
      if(r.is!==undefined) line+=` IS=${r.is}`;
      if(r.bf!==undefined) line+=` BF=${r.bf}`;
      if(r.br!==undefined) line+=` BR=${r.br}`;
      if(r.pnp) line+=` TYPE=PNP`;
      return line;
    }
    if(r.type==="E"||r.type==="G"){
      // out+ out- ctrl+ ctrl- value
      return `${r.name} ${r.nodeA} ${r.nodeB} ${r.nodeC} ${r.nodeD} ${r.value}`;
    }
    // V/I: [DC <value>] [PULSE(...)|SIN(...)] [AC <mag> <phase>], the
    // order the parser expects. DC is omitted only for a waveform row with
    // no explicit DC value, so the engine falls back to the waveform's rest
    // value (PULSE's V1, SIN's VO) exactly as a hand-written netlist would.
    let line=`${r.name} ${r.nodeA} ${r.nodeB}`;
    if(r.dcValue!==undefined) line+=` DC ${r.dcValue}`;
    if(r.waveform) line+=` ${waveformClause(r.waveform)}`;
    if(r.acMag) line+=` AC ${r.acMag} ${r.acPhase||0}`;
    return line;
  }).join("\n")+"\n";
}

/* ---- WASM result-text parsing ---- */
function checkOk(text){
  if(text.startsWith("ERROR:")) throw new Error(text.slice(6).trim());
  if(!text.startsWith("OK")) throw new Error("unexpected engine response: "+text.slice(0,120));
}
function parseDcResult(text){
  checkOk(text);
  const lines=text.trim().split("\n");
  const voltages=[], currents=[];
  for(let i=1;i<lines.length;i++){
    const parts=lines[i].split(",");
    if(parts[0]==="V") voltages.push({name:parts[1], value:parseFloat(parts[2])});
    else if(parts[0]==="I") currents.push({name:parts[1], value:parseFloat(parts[2])});
  }
  return {voltages, currents};
}
function parseTable(text){
  checkOk(text);
  const lines=text.trim().split("\n");
  const header=lines[1].split(",");
  const dataRows=lines.slice(2).map(l=>l.split(",").map(Number));
  return {header, dataRows};
}
function extractTransientNodeNames(header){
  return header.slice(1).filter(h=>h.startsWith("V(")&&h.endsWith(")")).map(h=>h.slice(2,-1));
}
function extractAcNodeNames(header){
  const names=[];
  for(let i=1;i<header.length;i+=2){
    const m=header[i].match(/^V\((.+)\)_mag_db$/);
    if(m) names.push(m[1]);
  }
  return names;
}

function renderPresets(){
  const el=document.getElementById("presets");
  el.innerHTML="";
  Object.keys(PRESETS).forEach(name=>{
    const b=document.createElement("button");
    b.className="chip"; b.textContent=name;
    b.onclick=()=>{
      // Deep copy, not a spread: a waveform row holds a nested object, and
      // a shallow copy would leave it shared with the PRESETS entry.
      rows = PRESETS[name].map(r=>JSON.parse(JSON.stringify(r)));
      const a=PRESET_ANALYSIS[name];
      if(a){
        document.getElementById("tran-dt").value=a.dt;
        document.getElementById("tran-stop").value=a.stop;
        setMode(a.mode);
      }
      renderTable(); save();
    };
    el.appendChild(b);
  });
  const clearBtn=document.createElement("button");
  clearBtn.className="chip"; clearBtn.textContent="Clear all";
  clearBtn.onclick=()=>{ rows=[]; renderTable(); save(); };
  el.appendChild(clearBtn);
}

function renderTable(){
  const body=document.getElementById("componentBody");
  body.innerHTML="";
  if(rows.length===0){
    body.innerHTML='<tr class="empty-row"><td colspan="6">No components yet — load a preset above or add one below.</td></tr>';
    return;
  }
  rows.forEach((r,idx)=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`
      <td data-label="Name" class="mono">${r.name}</td>
      <td data-label="Type">${r.type}</td>
      <td data-label="Nodes" class="mono">${r.type==="Q" ? `C:${r.nodeA} B:${r.nodeB} E:${r.nodeC}` : (r.type==="E"||r.type==="G") ? `${r.nodeA}\u2192${r.nodeB} ctrl:${r.nodeC}\u2192${r.nodeD}` : `${r.nodeA} \u2192 ${r.nodeB}`}</td>
      <td data-label="Value" class="mono">${fmtRowValue(r)}</td>
      <td data-label="Extra" class="mono">${fmtRowExtra(r)}</td>
      <td></td>`;
    const delTd=tr.lastElementChild;
    const delBtn=document.createElement("button");
    delBtn.className="row-del"; delBtn.textContent="\u00d7"; delBtn.title="Remove";
    delBtn.onclick=()=>{ rows.splice(idx,1); renderTable(); save(); };
    delTd.appendChild(delBtn);
    body.appendChild(tr);
  });
}

function updateAddFormFields(){
  const type=document.getElementById("f-type").value;
  const valueLabel=document.getElementById("f-value-label");
  const e1wrap=document.getElementById("f-extra1-wrap"), e2wrap=document.getElementById("f-extra2-wrap");
  const e1label=document.getElementById("f-extra1-label"), e2label=document.getElementById("f-extra2-label");
  const nodeAlabel=document.getElementById("f-nodeA-label"), nodeBlabel=document.getElementById("f-nodeB-label");
  const nodeCwrap=document.getElementById("f-nodeC-wrap"), nodeClabel=document.getElementById("f-nodeC-label");
  const nodeDwrap=document.getElementById("f-nodeD-wrap"), nodeDlabel=document.getElementById("f-nodeD-label");
  const pnpWrap=document.getElementById("f-pnp-wrap");
  document.getElementById("f-name").placeholder = NAME_EXAMPLE[type];

  nodeCwrap.style.display="none"; nodeDwrap.style.display="none"; pnpWrap.style.display="none";
  if(type==="Q"){
    nodeAlabel.textContent="Collector"; nodeBlabel.textContent="Base";
    nodeCwrap.style.display=""; nodeClabel.textContent="Emitter";
    pnpWrap.style.display="";
  } else if(type==="E"||type==="G"){
    nodeAlabel.textContent="Out +"; nodeBlabel.textContent="Out -";
    nodeCwrap.style.display=""; nodeClabel.textContent="Ctrl +";
    nodeDwrap.style.display=""; nodeDlabel.textContent="Ctrl -";
  } else {
    nodeAlabel.textContent="Node A"; nodeBlabel.textContent="Node B";
  }

  if(type==="R"){ valueLabel.textContent="Resistance"; e1wrap.style.display="none"; e2wrap.style.display="none"; }
  else if(type==="C"){ valueLabel.textContent="Capacitance"; e1wrap.style.display=""; e1label.textContent="IC (V)"; e2wrap.style.display="none"; }
  else if(type==="L"){ valueLabel.textContent="Inductance"; e1wrap.style.display=""; e1label.textContent="IC (A)"; e2wrap.style.display="none"; }
  else if(type==="D"){ valueLabel.textContent="IS (optional)"; e1wrap.style.display=""; e1label.textContent="N (optional)"; e2wrap.style.display="none"; }
  else if(type==="Q"){ valueLabel.textContent="IS (optional)"; e1wrap.style.display=""; e1label.textContent="BF (optional)"; e2wrap.style.display=""; e2label.textContent="BR (optional)"; }
  else if(type==="E"){ valueLabel.textContent="Gain"; e1wrap.style.display="none"; e2wrap.style.display="none"; }
  else if(type==="G"){ valueLabel.textContent="Transconductance"; e1wrap.style.display="none"; e2wrap.style.display="none"; }
  else { valueLabel.textContent="DC value"; e1wrap.style.display=""; e1label.textContent="AC magnitude"; e2wrap.style.display=""; e2label.textContent="AC phase (deg)"; }

  // Waveform selector + its parameter slots: V/I only.
  const isSource = type==="V"||type==="I";
  const wfSelect=document.getElementById("f-wf");
  if(!isSource) wfSelect.value="";
  document.getElementById("f-wf-wrap").style.display = isSource ? "" : "none";
  const spec = WAVEFORM_PARAMS[wfSelect.value];
  document.getElementById("f-wf-params").style.display = spec ? "" : "none";
  if(spec){
    // With a waveform attached, DC is optional (defaults to the rest value).
    valueLabel.textContent="DC value (optional)";
    for(let i=1;i<=7;i++){
      const p=spec[i-1];
      document.getElementById("f-wf"+i+"-wrap").style.display = p ? "" : "none";
      if(p){
        // The unit goes in its own span, exempt from the labels' CSS
        // uppercasing -- otherwise "(s)" for seconds renders as "(S)",
        // which reads as siemens.
        const lab=document.getElementById("f-wf"+i+"-label");
        lab.textContent = p.label+" ";
        const u=document.createElement("span");
        u.className="unit"; u.textContent=`(${waveformUnit(p,type)})`;
        lab.appendChild(u);
        document.getElementById("f-wf"+i).placeholder = p.required ? "required" : "0";
      }
    }
    document.getElementById("f-wf-hint").textContent = WAVEFORM_HINT[wfSelect.value];
  }
}

// Reads the waveform slots for the selected kind. Returns null when the
// waveform is "None"; throws with a user-facing message on invalid input.
function readWaveformFromForm(){
  const kind=document.getElementById("f-wf").value;
  const spec=WAVEFORM_PARAMS[kind];
  if(!spec) return null;
  const params=spec.map((p,i)=>{
    const str=document.getElementById("f-wf"+(i+1)).value.trim();
    if(!str){
      if(p.required) throw new Error(`${kind} needs ${p.key}.`);
      return 0;
    }
    const v=parseValue(str);
    if(!Number.isFinite(v)) throw new Error(`${kind} ${p.key} must be a finite number.`);
    if(p.nonneg && v<0) throw new Error(`${kind} ${p.key} can't be negative.`);
    return v;
  });
  if(kind==="SIN" && !(params[2]>0)) throw new Error("SIN FREQ must be positive.");
  // The engine accepts TR=PW=TF=0, but that pulse has zero width and just
  // sits at V1 forever -- almost certainly a forgotten PW, so say so.
  if(kind==="PULSE" && params[3]+params[4]+params[5]===0) throw new Error("PULSE has zero width: set PW (and/or TR/TF).");
  return {kind, params};
}

function addComponentFromForm(){
  const type=document.getElementById("f-type").value;
  const name=document.getElementById("f-name").value.trim();
  const nodeA=document.getElementById("f-nodeA").value.trim();
  const nodeB=document.getElementById("f-nodeB").value.trim();
  const nodeC=document.getElementById("f-nodeC").value.trim();
  const nodeD=document.getElementById("f-nodeD").value.trim();
  const valueStr=document.getElementById("f-value").value.trim();
  const extra1=document.getElementById("f-extra1").value.trim();
  const extra2=document.getElementById("f-extra2").value.trim();
  const isPnp=document.getElementById("f-pnp").checked;
  const errEl=document.getElementById("addError");
  errEl.classList.remove("show");
  try{
    if(!name) throw new Error("Name is required (e.g. "+NAME_EXAMPLE[type]+").");
    // The real .cir parser infers component type from the name's first
    // letter (R/C/L/V/I/D/Q/E/G), same as the CLI -- so the name must
    // agree with the selected type or the engine would silently parse it
    // as the wrong device.
    if(name[0].toUpperCase()!==type) throw new Error(`Names for a ${type} must start with '${type}' (e.g. ${NAME_EXAMPLE[type]}).`);
    if(rows.some(r=>r.name===name)) throw new Error("A component named '"+name+"' already exists.");
    if(!nodeA || !nodeB) throw new Error("Both nodes are required.");
    if(type==="Q" && !nodeC) throw new Error("A transistor needs all three nodes (collector, base, emitter).");
    if((type==="E"||type==="G") && (!nodeC || !nodeD)) throw new Error("A controlled source needs both control nodes too.");
    // Every type except D/Q requires its main value field; D's IS and Q's
    // IS/BF/BR all default to standard values if left blank. E/G always
    // require it (gain/transconductance has no sensible default).
    // A V/I with a waveform is the one other exception: blank DC falls back
    // to the waveform's rest value, same as a hand-written netlist.
    const waveform = (type==="V"||type==="I") ? readWaveformFromForm() : null;
    if(type!=="D" && type!=="Q" && !waveform && !valueStr) throw new Error("Value is required.");
    const value = valueStr ? parseValue(valueStr) : null;
    if((type==="R"||type==="C"||type==="L") && !(value>0)) throw new Error(type+" must have a positive value.");
    if((type==="D"||type==="Q") && value!==null && !(value>0)) throw new Error("IS must be positive.");
    let row={type, name, nodeA, nodeB};
    if(type==="Q") row.nodeC=nodeC;
    if(type==="E"||type==="G"){ row.nodeC=nodeC; row.nodeD=nodeD; }
    if(type==="R"||type==="C"||type==="L"){
      row.value=value;
      if((type==="C"||type==="L") && extra1) row.ic=parseValue(extra1);
    } else if(type==="D"){
      if(value!==null) row.is=value;
      if(extra1){
        const nval=parseValue(extra1);
        if(!(nval>0)) throw new Error("N must be positive.");
        row.n=nval;
      }
    } else if(type==="Q"){
      if(value!==null) row.is=value;
      if(extra1){
        const bfval=parseValue(extra1);
        if(!(bfval>0)) throw new Error("BF must be positive.");
        row.bf=bfval;
      }
      if(extra2){
        const brval=parseValue(extra2);
        if(!(brval>0)) throw new Error("BR must be positive.");
        row.br=brval;
      }
      if(isPnp) row.pnp=true;
    } else if(type==="E"||type==="G"){
      row.value=value;
    } else {
      if(value!==null) row.dcValue=value;
      if(waveform) row.waveform=waveform;
      if(extra1) row.acMag=parseValue(extra1);
      if(extra2) row.acPhase=parseValue(extra2);
    }
    rows.push(row);
    renderTable(); save();
    document.getElementById("f-name").value="";
    document.getElementById("f-nodeA").value="";
    document.getElementById("f-nodeB").value="";
    document.getElementById("f-nodeC").value="";
    document.getElementById("f-nodeD").value="";
    document.getElementById("f-value").value="";
    document.getElementById("f-extra1").value="";
    document.getElementById("f-extra2").value="";
    document.getElementById("f-pnp").checked=false;
    document.getElementById("f-wf").value="";
    for(let i=1;i<=7;i++) document.getElementById("f-wf"+i).value="";
    updateAddFormFields();
  }catch(e){
    errEl.textContent=e.message;
    errEl.classList.add("show");
  }
}

/* ---- tabs ---- */
function setMode(m){
  mode=m;
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active", t.dataset.mode===m));
  document.getElementById("params-dc").style.display = m==="dc" ? "" : "none";
  document.getElementById("params-tran").style.display = m==="tran" ? "" : "none";
  document.getElementById("params-ac").style.display = m==="ac" ? "" : "none";
  save();
}

/* ---- chart rendering (hand-drawn SVG, no external chart library) ---- */
function makeChartSVG({width=760, height=280, series, xLabel, yLabel, xLog=false, refLine=null}){
  const pad={l:52,r:14,t:14,b:32};
  const allX=series.flatMap(s=>s.points.map(p=>p.x));
  const allY=series.flatMap(s=>s.points.map(p=>p.y));
  let xmin=Math.min(...allX), xmax=Math.max(...allX);
  let ymin=Math.min(...allY), ymax=Math.max(...allY);
  if(refLine!==null){ ymin=Math.min(ymin,refLine); ymax=Math.max(ymax,refLine); }
  if(xmin===xmax){ xmin-=1; xmax+=1; }
  if(ymin===ymax){ ymin-=1; ymax+=1; }
  const yPad=(ymax-ymin)*0.1; ymin-=yPad; ymax+=yPad;
  const plotW=width-pad.l-pad.r, plotH=height-pad.t-pad.b;
  const lxmin=Math.log10(Math.max(xmin,1e-300)), lxmax=Math.log10(Math.max(xmax,1e-300));
  function xs(x){ return xLog ? pad.l+((Math.log10(x)-lxmin)/(lxmax-lxmin))*plotW : pad.l+((x-xmin)/(xmax-xmin))*plotW; }
  function ys(y){ return pad.t+plotH-((y-ymin)/(ymax-ymin))*plotH; }

  let svg=`<svg class="chart" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;
  const yTicks=5;
  for(let i=0;i<=yTicks;i++){
    const val=ymin+(ymax-ymin)*i/yTicks;
    const y=ys(val);
    svg+=`<line class="grid-line" x1="${pad.l}" y1="${y}" x2="${width-pad.r}" y2="${y}"/>`;
    svg+=`<text class="axis-label" x="${pad.l-6}" y="${y+3}" text-anchor="end">${fmtValue(val)}</text>`;
  }
  const xTicks=xLog ? Math.max(2,Math.round(lxmax-lxmin)) : 5;
  for(let i=0;i<=xTicks;i++){
    let val, x;
    if(xLog){ val=Math.pow(10, lxmin+(lxmax-lxmin)*i/xTicks); x=xs(val); }
    else { val=xmin+(xmax-xmin)*i/xTicks; x=xs(val); }
    svg+=`<line class="grid-line" x1="${x}" y1="${pad.t}" x2="${x}" y2="${height-pad.b}"/>`;
    svg+=`<text class="axis-label" x="${x}" y="${height-pad.b+16}" text-anchor="middle">${fmtValue(val)}</text>`;
  }
  if(refLine!==null){
    const y=ys(refLine);
    svg+=`<line x1="${pad.l}" y1="${y}" x2="${width-pad.r}" y2="${y}" stroke="var(--ink-dim)" stroke-dasharray="3,3" stroke-width="1"/>`;
  }
  svg+=`<text class="axis-label" x="${width/2}" y="${height-4}" text-anchor="middle">${xLabel}</text>`;
  svg+=`<text class="axis-label" transform="translate(12,${height/2}) rotate(-90)" text-anchor="middle">${yLabel}</text>`;
  series.forEach(s=>{
    const d=s.points.map((p,i)=> (i===0?"M":"L")+xs(p.x).toFixed(2)+","+ys(p.y).toFixed(2)).join(" ");
    svg+=`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2"/>`;
  });
  svg+="</svg>";
  return svg;
}

function legendHTML(series){
  return '<div class="legend">'+series.map(s=>`<span><span class="swatch" style="background:${s.color}"></span>${s.label}</span>`).join("")+'</div>';
}

/* ---- WASM module bootstrap ---- */
let msRunDc=null, msRunTran=null, msRunAc=null;
MiniSpiceModule().then((Module)=>{
  msRunDc = Module.cwrap('ms_run_dc', 'string', ['string']);
  msRunTran = Module.cwrap('ms_run_transient', 'string', ['string','number','number']);
  msRunAc = Module.cwrap('ms_run_ac', 'string', ['string','number','number','number']);
  const btn=document.getElementById("runBtn");
  btn.disabled=false; btn.textContent="Run simulation";
  load();
  updateAddFormFields();
  renderPresets();
  renderTable();
  setMode(mode);
  if(rows.length){ run(); }
}).catch((e)=>{
  const btn=document.getElementById("runBtn");
  btn.textContent="Engine failed to load";
  console.error(e);
});

/* ---- run + render results ---- */
function run(){
  const errEl=document.getElementById("runError");
  errEl.classList.remove("show");
  document.getElementById("resultsCard").classList.add("hidden");
  document.getElementById("runSummary").textContent="";
  if(rows.length===0){ errEl.textContent="Add at least one component first."; errEl.classList.add("show"); return; }
  if(!msRunDc){ errEl.textContent="Engine is still loading — try again in a moment."; errEl.classList.add("show"); return; }

  const netlist=rowsToNetlist(rows);

  try{
    if(mode==="dc"){
      const result=parseDcResult(msRunDc(netlist));
      renderDcResults(result);
      document.getElementById("runSummary").textContent = result.voltages.length+" nodes, "+result.currents.length+" voltage source(s)";
    } else if(mode==="tran"){
      const dt=parseValue(document.getElementById("tran-dt").value);
      const stop=parseValue(document.getElementById("tran-stop").value);
      const raw=msRunTran(netlist, dt, stop);
      const table=parseTable(raw);
      renderTransientResults(table, raw);
      document.getElementById("runSummary").textContent = table.dataRows.length+" timesteps";
    } else {
      const start=parseValue(document.getElementById("ac-start").value);
      const stop=parseValue(document.getElementById("ac-stop").value);
      const ppd=parseValue(document.getElementById("ac-ppd").value);
      const raw=msRunAc(netlist, start, stop, ppd);
      const table=parseTable(raw);
      renderAcResults(table, raw);
      document.getElementById("runSummary").textContent = table.dataRows.length+" frequency points";
    }
    document.getElementById("resultsCard").classList.remove("hidden");
    save();
  }catch(e){
    errEl.textContent=e.message;
    errEl.classList.add("show");
  }
}

function renderDcResults(result){
  let html='<table><thead><tr><th>Node</th><th>Voltage</th></tr></thead><tbody>';
  result.voltages.forEach(v=>{
    html+=`<tr><td data-label="Node" class="mono">V(${v.name})</td><td data-label="Voltage" class="mono">${fmtValue(v.value)} V</td></tr>`;
  });
  html+='</tbody></table>';
  if(result.currents.length){
    html+='<table style="margin-top:10px"><thead><tr><th>Source</th><th>Current</th></tr></thead><tbody>';
    result.currents.forEach(c=>{ html+=`<tr><td data-label="Source" class="mono">I(${c.name})</td><td data-label="Current" class="mono">${fmtValue(c.value)} A</td></tr>`; });
    html+='</tbody></table>';
  }
  document.getElementById("resultsBody").innerHTML=html;

  let raw="node,voltage_V\n"+result.voltages.map(v=>v.name+","+v.value).join("\n");
  if(result.currents.length) raw+="\n"+result.currents.map(c=>"I("+c.name+"),"+c.value).join("\n");
  setRaw(raw);
}

function renderTransientResults(table, rawText){
  const nodeNames=extractTransientNodeNames(table.header);
  if(nodeNames.length===0){
    document.getElementById("resultsBody").innerHTML='<p class="sub">No non-ground nodes to plot — every component connects only to ground.</p>';
    setRaw(rawText);
    return;
  }
  const timeIdx=0;
  const series=nodeNames.map((name,i)=>{
    const colIdx=table.header.indexOf("V("+name+")");
    return { label:"V("+name+")", color:TRACE_COLORS[i%TRACE_COLORS.length],
      points: table.dataRows.map(row=>({x:row[timeIdx], y:row[colIdx]})) };
  });
  let html = legendHTML(series);
  html += makeChartSVG({series, xLabel:"time (s)", yLabel:"voltage (V)", xLog:false});

  html += '<div class="stat-grid">';
  series.forEach(s=>{
    const ys=s.points.map(p=>p.y);
    let peakIdx=0;
    for(let i=1;i<ys.length;i++) if(Math.abs(ys[i])>Math.abs(ys[peakIdx])) peakIdx=i;
    const peak=ys[peakIdx];
    const final=ys[ys.length-1];
    html+=`<div class="stat"><span class="label">${s.label} final</span><div class="value">${fmtValue(final)} V</div></div>`;
    html+=`<div class="stat"><span class="label">${s.label} peak</span><div class="value">${fmtValue(peak)} V</div></div>`;
  });
  html += '</div>';
  document.getElementById("resultsBody").innerHTML=html;
  setRaw(rawText);
}

function renderAcResults(table, rawText){
  const nodeNames=extractAcNodeNames(table.header);
  if(nodeNames.length===0){
    document.getElementById("resultsBody").innerHTML='<p class="sub">No non-ground nodes to plot — every component connects only to ground.</p>';
    setRaw(rawText);
    return;
  }
  const freqIdx=0;
  const magSeries=nodeNames.map((name,i)=>{
    const colIdx=table.header.indexOf("V("+name+")_mag_db");
    return { label:"V("+name+")", color:TRACE_COLORS[i%TRACE_COLORS.length],
      points: table.dataRows.map(row=>({x:row[freqIdx], y:row[colIdx]})) };
  });
  const phaseSeries=nodeNames.map((name,i)=>{
    const colIdx=table.header.indexOf("V("+name+")_phase_deg");
    return { label:"V("+name+")", color:TRACE_COLORS[i%TRACE_COLORS.length],
      points: table.dataRows.map(row=>({x:row[freqIdx], y:row[colIdx]})) };
  });
  let html = legendHTML(magSeries);
  html += makeChartSVG({series:magSeries, xLabel:"frequency (Hz)", yLabel:"magnitude (dB)", xLog:true, refLine:-3.0103});
  html += '<div style="margin-top:10px"></div>';
  html += makeChartSVG({series:phaseSeries, xLabel:"frequency (Hz)", yLabel:"phase (deg)", xLog:true});
  document.getElementById("resultsBody").innerHTML=html;
  setRaw(rawText);
}

function setRaw(text){
  const ta=document.getElementById("rawData");
  ta.value=text.replace(/^OK\n/, ""); // strip the WASM boundary's "OK" marker line, keep just the data
  ta.classList.remove("show");
  document.getElementById("rawToggle").textContent="show raw data";
}

/* ---- persistence ---- */
function save(){
  try{
    const state={
      rows, mode,
      tranDt: document.getElementById("tran-dt").value, tranStop: document.getElementById("tran-stop").value,
      acStart: document.getElementById("ac-start").value, acStop: document.getElementById("ac-stop").value, acPpd: document.getElementById("ac-ppd").value,
    };
    localStorage.setItem("minispice_web_state_v1", JSON.stringify(state));
  }catch(e){ /* storage unavailable — fine, just don't persist */ }
}
function load(){
  try{
    const raw=localStorage.getItem("minispice_web_state_v1");
    if(!raw) return;
    const state=JSON.parse(raw);
    if(Array.isArray(state.rows)) rows=state.rows;
    if(state.tranDt) document.getElementById("tran-dt").value=state.tranDt;
    if(state.tranStop) document.getElementById("tran-stop").value=state.tranStop;
    if(state.acStart) document.getElementById("ac-start").value=state.acStart;
    if(state.acStop) document.getElementById("ac-stop").value=state.acStop;
    if(state.acPpd) document.getElementById("ac-ppd").value=state.acPpd;
    if(state.mode) mode=state.mode;
  }catch(e){ /* corrupt/unavailable storage — start fresh */ }
}

/* ---- wire up (module bootstrap above calls load()/render*() once WASM is ready) ---- */
document.getElementById("f-type").addEventListener("change", updateAddFormFields);
document.getElementById("f-wf").addEventListener("change", updateAddFormFields);
document.getElementById("addBtn").addEventListener("click", addComponentFromForm);
document.getElementById("runBtn").addEventListener("click", run);
document.querySelectorAll(".tab").forEach(t=>t.addEventListener("click", ()=>setMode(t.dataset.mode)));
document.getElementById("rawToggle").addEventListener("click", ()=>{
  const ta=document.getElementById("rawData");
  const showing=ta.classList.toggle("show");
  document.getElementById("rawToggle").textContent = showing ? "hide raw data" : "show raw data";
});
