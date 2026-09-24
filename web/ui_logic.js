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
  // same as examples/12
  "PULSE into RC filter": [
    {type:"V",name:"V1",nodeA:"in",nodeB:"0",waveform:{kind:"PULSE",params:[0,5,1e-3,1e-4,1e-4,2e-3,4e-3]}},
    {type:"R",name:"R1",nodeA:"in",nodeB:"out",value:1000},
    {type:"C",name:"C1",nodeA:"out",nodeB:"0",value:1e-6},
  ],
  // same as examples/13
  "SIN into RC filter": [
    {type:"V",name:"V1",nodeA:"in",nodeB:"0",waveform:{kind:"SIN",params:[1,2,500,0,0]}},
    {type:"R",name:"R1",nodeA:"in",nodeB:"out",value:1000},
    {type:"C",name:"C1",nodeA:"out",nodeB:"0",value:1e-7},
  ],
};

// Which analysis each preset opens (and runs) with. Settings match the ones
// used for the example plots.
const PRESET_ANALYSIS={
  "Voltage divider":       {mode:"dc"},
  "RC step":               {mode:"tran", dt:"1e-5", stop:"5e-3"},
  "RLC underdamped":       {mode:"tran", dt:"2e-6", stop:"3e-3"},
  "RC low-pass (AC)":      {mode:"ac", start:"10", stop:"1e6", ppd:"20"},
  "Wheatstone bridge":     {mode:"dc"},
  "Diode clipper":         {mode:"dc"},
  "BJT fixed-bias":        {mode:"dc"},
  "PNP fixed-bias":        {mode:"dc"},
  "VCVS amplifier":        {mode:"dc"},
  "VCCS transconductance": {mode:"dc"},
  "PULSE into RC filter":  {mode:"tran", dt:"2e-5", stop:"10e-3"},
  "SIN into RC filter":    {mode:"tran", dt:"2e-5", stop:"6e-3"},
};

const NAME_EXAMPLE={R:"R1",C:"C1",L:"L1",V:"V1",I:"I1",D:"D1",Q:"Q1",E:"E1",G:"G1"};
// placeholder for the value field
const VALUE_EXAMPLE={R:"1k",C:"1u",L:"10m",V:"5",I:"1m",D:"1e-14",Q:"1e-16",E:"2",G:"1m"};

// Names get pasted straight into the netlist, so only allow letters, digits
// and _. A space splits the field ("in put" became two nodes) and * or #
// starts a comment.
const NODE_RE=/^[A-Za-z0-9_]+$/;
const NAME_RE=/^[A-Za-z][A-Za-z0-9_]*$/;
const isGround = n => n==="0" || n.toLowerCase()==="gnd";

// so a typo like dt=1e-12 doesn't freeze the tab
const MAX_TRAN_STEPS=200000, MAX_AC_POINTS=20000;

/* ---- PULSE / SIN waveforms on V and I sources ----
   Same order as the netlist: PULSE(V1 V2 TD TR TF PW PER), SIN(VO VA FREQ TD THETA).
   Blank optional fields are written as 0 (real SPICE would fill some of
   them from .tran instead, see DESIGN_DECISIONS.md #18).
   unit "v" means V or A depending on the source type. */
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
// DC value when none was given (same as Waveform::rest_value())
function waveformRestValue(wf){ return wf.params[0]; }
function waveformClause(wf){ return `${wf.kind}(${wf.params.join(" ")})`; }
function fmtWaveform(wf){ return `${wf.kind}(${wf.params.map(fmtSpice).join(" ")})`; }

/* ---- value parsing / formatting ---- */
function parseValue(token){
  const m=String(token).trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(.*)$/);
  if(!m) throw new Error("not a valid number: '"+token+"'");
  const mant=parseFloat(m[1]); const suf=m[2].trim().toLowerCase();
  let mult=1;
  if(suf.startsWith("meg")) mult=1e6;
  else if(suf.length>0){ const t={t:1e12,g:1e9,k:1e3,m:1e-3,u:1e-6,n:1e-9,p:1e-12,f:1e-15}; mult=(t[suf[0]]!==undefined)?t[suf[0]]:1; }
  return mant*mult;
}

const SI_PREFIXES=[[1e12,"T"],[1e9,"G"],[1e6,"M"],[1e3,"k"],[1,""],[1e-3,"m"],[1e-6,"\u00b5"],[1e-9,"n"],[1e-12,"p"],[1e-15,"f"]];
// 4700 -> "4.7 kΩ", -4.1887e-5 -> "-41.89 µA"
function fmtSI(v, unit="", sig=4){
  if(!Number.isFinite(v)) return String(v);
  if(v===0) return unit ? "0 "+unit : "0";
  const a=Math.abs(v);
  for(const [f,p] of SI_PREFIXES){
    if(a>=f){
      const n=parseFloat((v/f).toPrecision(sig));
      return unit ? `${n} ${p}${unit}` : `${n}${p}`;
    }
  }
  const n=parseFloat(v.toPrecision(sig)).toString();
  return unit ? `${n} ${unit}` : n;
}
// same idea but SPICE style ("100u", "1meg"), used for waveform params
function fmtSpice(v){
  if(v===0) return "0";
  const a=Math.abs(v);
  for(const [f,p] of SI_PREFIXES){
    if(a>=f) return parseFloat((v/f).toPrecision(4))+({"\u00b5":"u","M":"meg"}[p] ?? p);
  }
  return parseFloat(v.toPrecision(4)).toString();
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function fmtValue(v){
  if (v===0) return "0";
  const a=Math.abs(v);
  if (a>=1e6 || a<1e-6) return v.toExponential(3);
  return parseFloat(v.toPrecision(5)).toString();
}
function fmtRowValue(r){
  if(r.type==="V"||r.type==="I"){
    // no DC value given -> show the one DC analysis will actually use
    const dc = r.dcValue!==undefined ? r.dcValue : waveformRestValue(r.waveform);
    return fmtSI(dc, r.type==="V"?"V":"A");
  }
  if(r.type==="D") return "IS "+fmtSI(r.is!==undefined?r.is:1e-14, "A");
  if(r.type==="Q") return "IS "+fmtSI(r.is!==undefined?r.is:1e-16, "A");
  if(r.type==="E") return "gain "+fmtSI(r.value);
  if(r.type==="G") return "gm "+fmtSI(r.value, "S");
  return fmtSI(r.value, r.type==="R"?"\u03a9":r.type==="C"?"F":"H");
}
function fmtRowExtra(r){
  if(r.type==="C"||r.type==="L") return (r.ic? "IC "+fmtSI(r.ic, r.type==="C"?"V":"A"):"");
  if(r.type==="V"||r.type==="I"){
    const parts=[];
    if(r.waveform) parts.push(fmtWaveform(r.waveform));
    if(r.acMag) parts.push("AC "+fmtSI(r.acMag)+"\u2220"+fmtValue(r.acPhase||0)+"\u00b0");
    return parts.join(" ");
  }
  if(r.type==="D") return "N "+fmtValue(r.n!==undefined?r.n:1.0);
  if(r.type==="Q") return (r.pnp?"PNP":"NPN")+" \u00b7 BF "+fmtValue(r.bf!==undefined?r.bf:100)+" \u00b7 BR "+fmtValue(r.br!==undefined?r.br:1);
  return "";
}

/* ---- rows -> netlist text ---- */
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
    // V/I: [DC x] [PULSE(...)|SIN(...)] [AC mag phase]. Leave DC out if it
    // wasn't given so the engine uses the waveform's starting value.
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
      cancelEdit();
      // deep copy (waveform rows have a nested object)
      rows = PRESETS[name].map(r=>JSON.parse(JSON.stringify(r)));
      const a=PRESET_ANALYSIS[name];
      if(a){
        if(a.mode==="tran"){
          document.getElementById("tran-dt").value=a.dt;
          document.getElementById("tran-stop").value=a.stop;
        } else if(a.mode==="ac"){
          document.getElementById("ac-start").value=a.start;
          document.getElementById("ac-stop").value=a.stop;
          document.getElementById("ac-ppd").value=a.ppd;
        }
        setMode(a.mode);
      }
      renderTable(); save();
      run();
    };
    el.appendChild(b);
  });
  const clearBtn=document.createElement("button");
  clearBtn.className="chip chip-clear"; clearBtn.textContent="Clear all";
  clearBtn.onclick=()=>{ cancelEdit(); rows=[]; renderTable(); save(); circuitChanged(); };
  el.appendChild(clearBtn);
}

// dim old results when the circuit changes
function circuitChanged(){
  const card=document.getElementById("resultsCard");
  if(!card.classList.contains("hidden")) card.classList.add("stale");
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
    if(idx===editingIndex) tr.className="editing";
    // escape anything the user typed
    const e=escapeHtml;
    const nodes = r.type==="Q" ? `C:${e(r.nodeA)} B:${e(r.nodeB)} E:${e(r.nodeC)}`
      : (r.type==="E"||r.type==="G") ? `${e(r.nodeA)}\u2192${e(r.nodeB)} ctrl:${e(r.nodeC)}\u2192${e(r.nodeD)}`
      : `${e(r.nodeA)} \u2192 ${e(r.nodeB)}`;
    tr.innerHTML=`
      <td data-label="Name" class="mono">${e(r.name)}</td>
      <td data-label="Type">${e(r.type)}</td>
      <td data-label="Nodes" class="mono">${nodes}</td>
      <td data-label="Value" class="mono">${e(fmtRowValue(r))}</td>
      <td data-label="Extra" class="mono">${e(fmtRowExtra(r))}</td>
      <td><div class="row-actions"></div></td>`;
    const actions=tr.querySelector(".row-actions");
    const editBtn=document.createElement("button");
    editBtn.className="row-edit"; editBtn.textContent="\u270e"; editBtn.title="Edit"; editBtn.setAttribute("aria-label","Edit "+r.name);
    editBtn.onclick=()=>startEdit(idx);
    const delBtn=document.createElement("button");
    delBtn.className="row-del"; delBtn.textContent="\u00d7"; delBtn.title="Remove"; delBtn.setAttribute("aria-label","Remove "+r.name);
    delBtn.onclick=()=>{
      if(idx===editingIndex) cancelEdit();
      else if(idx<editingIndex) editingIndex--;
      rows.splice(idx,1); renderTable(); save(); circuitChanged();
    };
    actions.appendChild(editBtn); actions.appendChild(delBtn);
    body.appendChild(tr);
  });
}

/* ---- editing a row (loads it into the form, Save replaces it) ---- */
let editingIndex=-1;
const FORM_TEXT_IDS=["f-name","f-nodeA","f-nodeB","f-nodeC","f-nodeD","f-value","f-extra1","f-extra2","f-wf1","f-wf2","f-wf3","f-wf4","f-wf5","f-wf6","f-wf7"];
function clearForm(){
  FORM_TEXT_IDS.forEach(id=>{ document.getElementById(id).value=""; });
  document.getElementById("f-pnp").checked=false;
  document.getElementById("f-wf").value="";
  document.getElementById("addError").classList.remove("show");
}
function setEditMode(on){
  document.getElementById("addBtn").textContent = on ? "Save changes" : "+ Add";
  document.getElementById("cancelEditBtn").hidden = !on;
}
function startEdit(idx){
  const r=rows[idx];
  editingIndex=idx;
  clearForm();
  // use the exact number so saving without changes doesn't round anything
  const put=(id,v)=>{ if(v!==undefined && v!==null) document.getElementById(id).value=String(v); };
  document.getElementById("f-type").value=r.type;
  put("f-name",r.name); put("f-nodeA",r.nodeA); put("f-nodeB",r.nodeB); put("f-nodeC",r.nodeC); put("f-nodeD",r.nodeD);
  if(r.type==="R"||r.type==="C"||r.type==="L"||r.type==="E"||r.type==="G") put("f-value",r.value);
  if(r.type==="C"||r.type==="L") put("f-extra1",r.ic);
  if(r.type==="D"){ put("f-value",r.is); put("f-extra1",r.n); }
  if(r.type==="Q"){ put("f-value",r.is); put("f-extra1",r.bf); put("f-extra2",r.br); document.getElementById("f-pnp").checked=!!r.pnp; }
  if(r.type==="V"||r.type==="I"){
    put("f-value",r.dcValue); put("f-extra1",r.acMag); put("f-extra2",r.acPhase);
    if(r.waveform){
      document.getElementById("f-wf").value=r.waveform.kind;
      r.waveform.params.forEach((v,i)=>put("f-wf"+(i+1),v));
    }
  }
  updateAddFormFields();
  setEditMode(true);
  renderTable();
  const form=document.querySelector(".addform");
  if(form.scrollIntoView) form.scrollIntoView({block:"nearest", behavior:"smooth"});
  document.getElementById("f-name").focus();
}
function cancelEdit(){
  if(editingIndex<0) return;
  editingIndex=-1;
  clearForm(); updateAddFormFields(); setEditMode(false); renderTable();
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
  document.getElementById("f-value").placeholder = VALUE_EXAMPLE[type];

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

  // waveform stuff, V and I only
  const isSource = type==="V"||type==="I";
  const wfSelect=document.getElementById("f-wf");
  if(!isSource) wfSelect.value="";
  document.getElementById("f-wf-wrap").style.display = isSource ? "" : "none";
  const spec = WAVEFORM_PARAMS[wfSelect.value];
  document.getElementById("f-wf-params").style.display = spec ? "" : "none";
  if(spec){
    valueLabel.textContent="DC value (optional)";
    for(let i=1;i<=7;i++){
      const p=spec[i-1];
      document.getElementById("f-wf"+i+"-wrap").style.display = p ? "" : "none";
      if(p){
        // unit in its own span so the uppercase CSS doesn't turn s into S
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

// returns null for no waveform, throws a readable error on bad input
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
  // TR=PW=TF=0 is legal but just sits at V1 forever, probably a missing PW
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
    // the parser gets the type from the first letter, so they have to match
    if(name[0].toUpperCase()!==type) throw new Error(`Names for a ${type} must start with '${type}' (e.g. ${NAME_EXAMPLE[type]}).`);
    if(!NAME_RE.test(name)) throw new Error(`Name '${name}' can only use letters, digits and _ (no spaces or symbols).`);
    // R1 and r1 count as the same name (like SPICE). Skip the row being edited.
    const clash=rows.find((r,i)=>i!==editingIndex && r.name.toLowerCase()===name.toLowerCase());
    if(clash) throw new Error(`A component named '${clash.name}' already exists.`);
    if(!nodeA || !nodeB) throw new Error("Both nodes are required.");
    if(type==="Q" && !nodeC) throw new Error("A transistor needs all three nodes (collector, base, emitter).");
    if((type==="E"||type==="G") && (!nodeC || !nodeD)) throw new Error("A controlled source needs both control nodes too.");
    const newNodes=[nodeA,nodeB].concat(type==="Q"?[nodeC]:[]).concat((type==="E"||type==="G")?[nodeC,nodeD]:[]);
    for(const n of newNodes){
      if(!NODE_RE.test(n)) throw new Error(`Node '${n}' can only use letters, digits and _ (no spaces or symbols).`);
    }
    // node names are case sensitive, so "Out" vs "out" would be two separate
    // nodes. Almost always a typo, so flag it.
    const existing=new Set();
    rows.forEach((r,i)=>{ if(i!==editingIndex) [r.nodeA,r.nodeB,r.nodeC,r.nodeD].forEach(n=>{ if(n) existing.add(n); }); });
    for(const n of newNodes){
      if(isGround(n) || existing.has(n)) continue;
      const near=[...existing].find(m=>!isGround(m) && m.toLowerCase()===n.toLowerCase());
      if(near) throw new Error(`Node '${n}' differs from the existing node '${near}' only in capitalization. Node names are case-sensitive, so these would be two separate, unconnected nodes; use '${near}' to connect to it.`);
    }
    // Value is required except for D/Q (defaults) and V/I with a waveform.
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
    if(editingIndex>=0){ rows[editingIndex]=row; editingIndex=-1; setEditMode(false); }
    else rows.push(row);
    renderTable(); save(); circuitChanged();
    clearForm();
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

/* ---- charts (plain SVG) ---- */

// tick step of 1, 2 or 5 x 10^k
function niceStep(span, target){
  const raw=span/Math.max(1,target);
  const p=Math.pow(10, Math.floor(Math.log10(raw)));
  const m=raw/p;
  return (m<1.5?1 : m<3?2 : m<7?5 : 10)*p;
}
function ticksBetween(lo, hi, step){
  const out=[];
  for(let k=Math.ceil(lo/step-1e-9); k*step<=hi+step*1e-9; k++) out.push(k*step);
  return out;
}
// one prefix per axis, e.g. "time (ms)" with ticks 0 1 2 3
function axisPrefix(maxAbs){
  for(const [f,p] of SI_PREFIXES) if(maxAbs>=f) return {f,p};
  return {f:1,p:""};
}
function tickLabel(v, f, step){
  const d=Math.min(6, Math.max(0, -Math.floor(Math.log10(step/f)+1e-9)));
  const t=(v/f).toFixed(d);
  return /^-0(\.0*)?$/.test(t) ? t.slice(1) : t;
}

// per-chart data for the hover tooltip
let chartSeq=0, CHARTS={};

function makeChart({series, xLabel, xUnit="", yLabel, yUnit="", xLog=false, refLine=null, refLabel="", yPrefixed=true}){
  const pageW=(document.querySelector(".page")||{}).clientWidth||0;
  // size to the screen so the text isn't tiny on phones
  const W=Math.max(320, Math.min(900, pageW ? pageW-42 : 760));
  const H=W<520 ? 250 : 300;
  const pad={l:62, r:18, t:14, b:42};
  const plotW=W-pad.l-pad.r, plotH=H-pad.t-pad.b;

  const allX=series.flatMap(s=>s.points.map(p=>p.x));
  const allY=series.flatMap(s=>s.points.map(p=>p.y)).filter(Number.isFinite);
  let xmin=Math.min(...allX), xmax=Math.max(...allX);
  let ymin=Math.min(...allY), ymax=Math.max(...allY);
  if(refLine!==null){ ymin=Math.min(ymin,refLine); ymax=Math.max(ymax,refLine); }
  if(xmin===xmax){ xmin-=1; xmax+=1; }
  if(ymax-ymin < 1e-12*Math.max(1,Math.abs(ymax))){ const c=ymin; ymin=c-(Math.abs(c)||1)*0.5; ymax=c+(Math.abs(c)||1)*0.5; }
  // pad a bit then round the y range out to whole ticks
  const ypad=(ymax-ymin)*0.04; ymin-=ypad; ymax+=ypad;
  const ystep=niceStep(ymax-ymin, H<280?4:5);
  ymin=Math.floor(ymin/ystep)*ystep; ymax=Math.ceil(ymax/ystep)*ystep;

  const lx0=Math.log10(Math.max(xmin,1e-300)), lx1=Math.log10(Math.max(xmax,1e-300));
  const xs=x=> xLog ? pad.l+((Math.log10(x)-lx0)/(lx1-lx0))*plotW : pad.l+((x-xmin)/(xmax-xmin))*plotW;
  const ys=y=> pad.t+plotH-((y-ymin)/(ymax-ymin))*plotH;

  const yp=yPrefixed ? axisPrefix(Math.max(Math.abs(ymin),Math.abs(ymax))) : {f:1,p:""};
  const e=escapeHtml;
  let svg=`<svg class="chart" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${e(yLabel)} vs ${e(xLabel)}">`;
  for(const v of ticksBetween(ymin, ymax, ystep)){
    const y=ys(v);
    svg+=`<line class="grid-line" x1="${pad.l}" y1="${y}" x2="${W-pad.r}" y2="${y}"/>`;
    svg+=`<text class="axis-label" x="${pad.l-7}" y="${y+3.5}" text-anchor="end">${tickLabel(v, yp.f, ystep)}</text>`;
  }
  let xTitle;
  if(xLog){
    // decade ticks + faint lines at 2..9
    const k0=Math.ceil(lx0-1e-9), k1=Math.floor(lx1+1e-9);
    for(let k=Math.floor(lx0); k<=k1; k++){
      for(let m=2;m<=9;m++){ const v=m*Math.pow(10,k); if(v>xmin && v<xmax){ const x=xs(v); svg+=`<line class="grid-minor" x1="${x}" y1="${pad.t}" x2="${x}" y2="${H-pad.b}"/>`; } }
    }
    for(let k=k0;k<=k1;k++){
      const v=Math.pow(10,k), x=xs(v);
      svg+=`<line class="grid-line" x1="${x}" y1="${pad.t}" x2="${x}" y2="${H-pad.b}"/>`;
      svg+=`<text class="axis-label" x="${x}" y="${H-pad.b+16}" text-anchor="middle">${fmtSI(v)}</text>`;
    }
    xTitle=`${xLabel} (${xUnit})`;
  } else {
    const xstep=niceStep(xmax-xmin, W<520?4:6);
    const xp=axisPrefix(Math.max(Math.abs(xmin),Math.abs(xmax)));
    for(const v of ticksBetween(xmin, xmax, xstep)){
      const x=xs(v);
      svg+=`<line class="grid-line" x1="${x}" y1="${pad.t}" x2="${x}" y2="${H-pad.b}"/>`;
      svg+=`<text class="axis-label" x="${x}" y="${H-pad.b+16}" text-anchor="middle">${tickLabel(v, xp.f, xstep)}</text>`;
    }
    xTitle=`${xLabel} (${xp.p}${xUnit})`;
  }
  if(refLine!==null){
    const y=ys(refLine);
    svg+=`<line x1="${pad.l}" y1="${y}" x2="${W-pad.r}" y2="${y}" stroke="var(--ink-dim)" stroke-dasharray="3,3" stroke-width="1"/>`;
    // put the label under the line so it doesn't overlap the 0 dB trace
    if(refLabel) svg+=`<text class="axis-label" x="${W-pad.r-4}" y="${y+13}" text-anchor="end">${e(refLabel)}</text>`;
  }
  svg+=`<text class="axis-label" x="${pad.l+plotW/2}" y="${H-6}" text-anchor="middle">${e(xTitle)}</text>`;
  svg+=`<text class="axis-label" transform="translate(13,${pad.t+plotH/2}) rotate(-90)" text-anchor="middle">${e(yLabel)} (${e(yp.p+yUnit)})</text>`;
  series.forEach(s=>{
    const d=s.points.map((p,i)=> (i===0?"M":"L")+xs(p.x).toFixed(2)+","+ys(p.y).toFixed(2)).join(" ");
    svg+=`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`;
  });
  svg+=`<line class="hover-x" x1="0" y1="${pad.t}" x2="0" y2="${H-pad.b}" visibility="hidden"/>`;
  series.forEach(s=>{ svg+=`<circle class="hover-dot" r="3.5" fill="${s.color}" stroke="var(--surface)" stroke-width="1.5" visibility="hidden"/>`; });
  svg+="</svg>";

  const id="c"+(++chartSeq);
  const yFmt=v=>fmtSI(v, yUnit, 5);
  CHARTS[id]={W, pad, plotW, xs, ys, xLog, xmin, xmax, lx0, lx1, series,
    xFmt:v=>fmtSI(v, xUnit, 5), yFmt: yPrefixed ? yFmt : v=>`${parseFloat(v.toFixed(3))} ${yUnit}`};
  return `<div class="chart-wrap" data-chart="${id}">${svg}<div class="chart-tip" hidden></div></div>`;
}

// hover / touch: crosshair at the nearest point + tooltip with the values
function attachChartHover(root){
  root.querySelectorAll(".chart-wrap").forEach(wrap=>{
    const st=CHARTS[wrap.dataset.chart]; if(!st) return;
    const svg=wrap.querySelector("svg"), tip=wrap.querySelector(".chart-tip");
    const line=svg.querySelector(".hover-x"), dots=[...svg.querySelectorAll(".hover-dot")];
    const pts=st.series[0].points;
    const hide=()=>{ tip.hidden=true; line.setAttribute("visibility","hidden"); dots.forEach(d=>d.setAttribute("visibility","hidden")); };
    const show=clientX=>{
      const rect=svg.getBoundingClientRect(); if(!rect.width) return;
      const vx=(clientX-rect.left)/rect.width*st.W;
      const frac=(vx-st.pad.l)/st.plotW;
      if(frac<-0.02 || frac>1.02){ hide(); return; }
      const target = st.xLog ? Math.pow(10, st.lx0+frac*(st.lx1-st.lx0)) : st.xmin+frac*(st.xmax-st.xmin);
      let lo=0, hi=pts.length-1;             // points are sorted by x
      while(hi-lo>1){ const mid=(lo+hi)>>1; if(pts[mid].x<target) lo=mid; else hi=mid; }
      const i = Math.abs(st.xs(pts[lo].x)-vx) <= Math.abs(st.xs(pts[hi].x)-vx) ? lo : hi;
      const px=st.xs(pts[i].x);
      line.setAttribute("x1",px); line.setAttribute("x2",px); line.setAttribute("visibility","visible");
      let html=`<div class="tip-x">${escapeHtml(st.xFmt(pts[i].x))}</div>`;
      st.series.forEach((s,k)=>{
        const y=s.points[i].y;
        dots[k].setAttribute("cx",px); dots[k].setAttribute("cy",st.ys(y)); dots[k].setAttribute("visibility","visible");
        html+=`<div><span class="swatch" style="background:${s.color}"></span> ${escapeHtml(s.label)} <b>${escapeHtml(st.yFmt(y))}</b></div>`;
      });
      tip.innerHTML=html; tip.hidden=false;
      const left=px/st.W*rect.width, tw=tip.offsetWidth||160;
      tip.style.left = (left+14+tw < rect.width ? left+14 : Math.max(0,left-14-tw))+"px";
    };
    svg.addEventListener("pointermove", ev=>show(ev.clientX));
    svg.addEventListener("pointerdown", ev=>show(ev.clientX));
    svg.addEventListener("pointerleave", hide);
  });
}

function legendHTML(series){
  return '<div class="legend">'+series.map(s=>`<span><span class="swatch" style="background:${s.color}"></span>${escapeHtml(s.label)}</span>`).join("")+'</div>';
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

function readParam(id, label){
  const str=document.getElementById(id).value.trim();
  let v;
  try{ v=parseValue(str); }catch(e){ throw new Error(`${label}: '${str}' isn't a number.`); }
  if(!Number.isFinite(v)) throw new Error(`${label} must be a finite number.`);
  return v;
}

function run(){
  const errEl=document.getElementById("runError");
  errEl.classList.remove("show");
  const card=document.getElementById("resultsCard");
  card.classList.add("hidden"); card.classList.remove("stale");
  document.getElementById("runSummary").textContent="";
  if(rows.length===0){ errEl.textContent="Add at least one component first."; errEl.classList.add("show"); return; }
  if(!msRunDc){ errEl.textContent="Engine is still loading — try again in a moment."; errEl.classList.add("show"); return; }

  const netlist=rowsToNetlist(rows);
  CHARTS={};

  try{
    if(mode==="dc"){
      const result=parseDcResult(msRunDc(netlist));
      renderDcResults(result);
      document.getElementById("runSummary").textContent = result.voltages.length+" nodes, "+result.currents.length+" voltage source(s)";
    } else if(mode==="tran"){
      const dt=readParam("tran-dt","dt"), stop=readParam("tran-stop","stop");
      if(!(dt>0)) throw new Error("dt must be positive.");
      if(!(stop>0)) throw new Error("stop must be positive.");
      const steps=Math.ceil(stop/dt);
      if(steps>MAX_TRAN_STEPS) throw new Error(`That's ${steps.toLocaleString("en-US")} timesteps (stop / dt); the limit is ${MAX_TRAN_STEPS.toLocaleString("en-US")} so the page stays responsive. Use a larger dt or a shorter stop.`);
      const raw=msRunTran(netlist, dt, stop);
      const table=parseTable(raw);
      renderTransientResults(table, raw);
      document.getElementById("runSummary").textContent = table.dataRows.length.toLocaleString("en-US")+" timesteps";
    } else {
      const start=readParam("ac-start","start"), stop=readParam("ac-stop","stop"), ppd=readParam("ac-ppd","points/decade");
      if(!(start>0)) throw new Error("start frequency must be positive (the sweep is logarithmic).");
      if(!(stop>=start)) throw new Error("stop frequency must be at least the start frequency.");
      // engine takes an int (2.5 used to get truncated to 2)
      if(!Number.isInteger(ppd) || ppd<1) throw new Error("points/decade must be a whole number, 1 or more.");
      const npts=Math.ceil(Math.log10(stop/start)*ppd)+1;
      if(npts>MAX_AC_POINTS) throw new Error(`That's ${npts.toLocaleString("en-US")} frequency points; the limit is ${MAX_AC_POINTS.toLocaleString("en-US")}. Use fewer points/decade or a narrower range.`);
      // with no AC source everything is 0 (used to plot as -6000 dB)
      if(!rows.some(r=>(r.type==="V"||r.type==="I") && r.acMag)) throw new Error("Nothing drives the AC sweep: no source has an AC magnitude. Give a V or I source an AC magnitude (e.g. 1), like the RC low-pass (AC) preset does.");
      const raw=msRunAc(netlist, start, stop, ppd);
      const table=parseTable(raw);
      renderAcResults(table, raw);
      document.getElementById("runSummary").textContent = table.dataRows.length.toLocaleString("en-US")+" frequency points";
    }
    card.classList.remove("hidden");
    attachChartHover(document.getElementById("resultsBody"));
    save();
  }catch(e){
    errEl.textContent=e.message;
    errEl.classList.add("show");
  }
}

function renderDcResults(result){
  const e=escapeHtml;
  let html='<table><thead><tr><th>Node</th><th>Voltage</th></tr></thead><tbody>';
  result.voltages.forEach(v=>{
    html+=`<tr><td data-label="Node" class="mono">V(${e(v.name)})</td><td data-label="Voltage" class="mono">${e(fmtSI(v.value,"V",5))}</td></tr>`;
  });
  html+='</tbody></table>';
  if(result.currents.length){
    html+='<table style="margin-top:10px"><thead><tr><th>Source</th><th>Current</th></tr></thead><tbody>';
    result.currents.forEach(c=>{ html+=`<tr><td data-label="Source" class="mono">I(${e(c.name)})</td><td data-label="Current" class="mono">${e(fmtSI(c.value,"A",5))}</td></tr>`; });
    html+='</tbody></table>';
    html+='<p class="chart-hint">A source delivering current reads negative (SPICE convention: current is measured flowing into the + terminal).</p>';
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
  const series=nodeNames.map((name,i)=>{
    const colIdx=table.header.indexOf("V("+name+")");
    return { label:"V("+name+")", color:TRACE_COLORS[i%TRACE_COLORS.length],
      points: table.dataRows.map(row=>({x:row[0], y:row[colIdx]})) };
  });
  let html = legendHTML(series);
  html += makeChart({series, xLabel:"time", xUnit:"s", yLabel:"voltage", yUnit:"V"});
  html += '<p class="chart-hint">Hover or drag across the graph to read exact values.</p>';
  html += '<div class="stat-grid">';
  series.forEach(s=>{
    const ys=s.points.map(p=>p.y);
    let peakIdx=0;
    for(let i=1;i<ys.length;i++) if(Math.abs(ys[i])>Math.abs(ys[peakIdx])) peakIdx=i;
    html+=`<div class="stat"><span class="label">${escapeHtml(s.label)} final</span><div class="value">${escapeHtml(fmtSI(ys[ys.length-1],"V"))}</div></div>`;
    html+=`<div class="stat"><span class="label">${escapeHtml(s.label)} peak</span><div class="value">${escapeHtml(fmtSI(ys[peakIdx],"V"))}</div></div>`;
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
  const mk=(suffix)=>nodeNames.map((name,i)=>{
    const colIdx=table.header.indexOf("V("+name+")"+suffix);
    return { label:"V("+name+")", color:TRACE_COLORS[i%TRACE_COLORS.length],
      points: table.dataRows.map(row=>({x:row[0], y:row[colIdx]})) };
  });
  const magSeries=mk("_mag_db"), phaseSeries=mk("_phase_deg");
  let html = legendHTML(magSeries);
  html += makeChart({series:magSeries, xLabel:"frequency", xUnit:"Hz", yLabel:"magnitude", yUnit:"dB", xLog:true, refLine:-3.0103, refLabel:"−3 dB", yPrefixed:false});
  html += makeChart({series:phaseSeries, xLabel:"frequency", xUnit:"Hz", yLabel:"phase", yUnit:"°", xLog:true, yPrefixed:false});
  html += '<p class="chart-hint">Hover or drag across either graph to read exact values. Magnitude is relative to the AC source amplitude.</p>';
  document.getElementById("resultsBody").innerHTML=html;
  setRaw(rawText);
}

let lastRaw="", lastRawMode="dc";
function setRaw(text){
  const ta=document.getElementById("rawData");
  lastRaw=text.replace(/^OK\n/, ""); // strip the WASM boundary's "OK" marker line, keep just the data
  lastRawMode=mode;
  ta.value=lastRaw;
  ta.classList.remove("show");
  document.getElementById("rawToggle").textContent="show raw data";
}
function downloadCsv(){
  if(!lastRaw) return;
  try{
    const url=URL.createObjectURL(new Blob([lastRaw], {type:"text/csv"}));
    const a=document.createElement("a");
    a.href=url; a.download=`mini-spice-${({dc:"dc",tran:"transient",ac:"ac"})[lastRawMode]}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  }catch(e){ /* no Blob/URL support: the raw-data box still has it */ }
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

/* ---- event listeners ---- */
document.getElementById("f-type").addEventListener("change", updateAddFormFields);
document.getElementById("f-wf").addEventListener("change", updateAddFormFields);
document.getElementById("addBtn").addEventListener("click", addComponentFromForm);
document.getElementById("cancelEditBtn").addEventListener("click", cancelEdit);
document.getElementById("downloadCsv").addEventListener("click", downloadCsv);
// Enter = add/save, Escape = cancel edit, Enter in analysis fields = run
document.querySelector(".addform").addEventListener("keydown", ev=>{
  if(ev.key==="Enter" && ev.target.tagName==="INPUT" && ev.target.type!=="checkbox"){ ev.preventDefault(); addComponentFromForm(); }
  else if(ev.key==="Escape") cancelEdit();
});
["params-tran","params-ac"].forEach(id=>document.getElementById(id).addEventListener("keydown", ev=>{
  if(ev.key==="Enter"){ ev.preventDefault(); run(); }
}));
document.getElementById("runBtn").addEventListener("click", run);
document.querySelectorAll(".tab").forEach(t=>t.addEventListener("click", ()=>setMode(t.dataset.mode)));
document.getElementById("rawToggle").addEventListener("click", ()=>{
  const ta=document.getElementById("rawData");
  const showing=ta.classList.toggle("show");
  document.getElementById("rawToggle").textContent = showing ? "hide raw data" : "show raw data";
});
