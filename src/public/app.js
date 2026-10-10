/* Gluetun Web UI - app.js */

const MAX_HISTORY = 30;
const VALID_STATES = new Set(['connected', 'paused', 'disconnected', 'unknown']);

let instances = []; // [{ id, name }] from /api/instances
let isPolling = false;
let refreshTimer = null;

let jsondata = []; // Providers JSON of servers at /api/data
let jsonkeys = []; // Providers Valid Keys
let protocols = []; //store tcp/udp options

let vpnprovider = null;

// Possible keys and labels that we will filter on (SWITCH is a holder for EITHER of tcp or udp)
const proKeys = ['vpn', 'SWITCH', 'categories', 'region', 'country', 'city', 'hostname'];
const proLabels = ['Protocol', 'SWITCH', 'Category', 'Region', 'Country', 'City', 'Hostname'];
// below will be the actual keys and labels from above possibles that the selected provider supports
let KEYS = [];
let KeyLabels = [];


// ---- Utility ----

function $(id) {
	return document.getElementById(id);
}
function setText(id, val) {
	const el = $(id);
	if (el)
		el.textContent = val ?? '-';
}
function setEl(id, val) {
	const el = document.getElementById(id);
	if (el)
		el.textContent = val ?? '-';
}

function setDL(id, val) {
	// Get the select element
	const select = document.getElementById(id);
	// Create a new option element
	const el = document.createElement("option");
	// Add our value to the option
	if (Array.isArray(val)) {
		el.textContent = val[0];
		el.value = val[0];
	} else {
		el.textContent = val;
		el.value = val;
	}
	// Set the option to selected
	el.selected = true;
	// Add the new option element to the select element
	select.appendChild(el);
}

function escHtml(str) {
	return String(str)
	.replace(/&/g, '&amp;').replace(/</g, '&lt;')
	.replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showToast(msg, type = 'info', duration = 3500) {
	const t = $('toast');
	t.textContent = msg;
	t.className = `toast ${type}`;
	clearTimeout(t._timer);
	t._timer = setTimeout(() => {
		t.className = 'toast hidden';
	}, duration);
}

// ---- Per-instance session history ----

function sessionKey(id) {
	return `gluetun_history_${id}`;
}

function loadHistoryFor(id) {
	try {
		const raw = JSON.parse(sessionStorage.getItem(sessionKey(id)));
		return Array.isArray(raw) ? raw.filter(s => VALID_STATES.has(s)) : [];
	} catch (_) {
		return [];
	}
}

function pushHistoryFor(id, state) {
	const hist = loadHistoryFor(id);
	hist.push(state);
	if (hist.length > MAX_HISTORY)
		hist.shift();
	try {
		sessionStorage.setItem(sessionKey(id), JSON.stringify(hist));
	} catch (_) {}
}

function renderHistoryFor(id) {
	const track = document.getElementById(`i${id}-history-track`);
	if (!track)
		return;
	const hist = loadHistoryFor(id);
	track.innerHTML = '';
	hist.forEach((s, i) => {
		const tick = document.createElement('div');
		tick.className = `history-tick ${s}`;
		tick.title = `Poll #${i + 1}: ${s}`;
		track.appendChild(tick);
	});
}

// ---- Dashboard group builder (old layout per instance) ----

function buildDashboardGroup(inst) {
	const id = inst.id;
	const group = document.createElement('div');
	group.className = 'dashboard-group';
	group.id = `dashboard-${id}`;
	group.innerHTML = `
    <!-- Status banner -->
    <div class="status-banner unknown" id="i${id}-banner">
      <div class="banner-icon">&#9679;</div>
      <div class="banner-text">
        <span id="i${id}-banner-title">Checking VPN status…</span>
        <span id="i${id}-banner-sub" class="muted"></span>
      </div>
      <div class="banner-actions">
        <button id="i${id}-btn-start" class="btn-success">&#9654; Start</button>
        <button id="i${id}-btn-stop" class="btn-danger">&#9209; Stop</button>
      </div>
    </div>

    <div class="dashboard-grid">
      <!-- Public IP card -->
      <div class="card">
        <div class="card-header">
          <span class="card-icon">&#127760;</span>
          <h3>${escHtml(inst.name)}</h3>
        </div>
        <div class="card-body">
          <div class="stat-row"><span class="stat-label">Public IP</span><span class="stat-value mono" id="i${id}-ip-address">-</span></div>
          <div class="stat-row"><span class="stat-label">Provider</span><span class="stat-value" id="i${id}-vpn-provider">-</span></div>
          <div class="stat-row"><span class="stat-label">Protocol</span><span class="stat-value" id="i${id}-vpn-protocol">-</span></div>
          <div class="stat-row"><span class="stat-label">Region</span><span class="stat-value" id="i${id}-ip-regions">-</span></div>
          <div class="stat-row"><span class="stat-label">Country</span><span class="stat-value" id="i${id}-ip-country">-</span></div>
          <div class="stat-row"><span class="stat-label">City</span><span class="stat-value" id="i${id}-ip-city">-</span></div>
          <div class="stat-row"><span class="stat-label">Server</span><span class="stat-value" id="i${id}-ip-server">-</span></div>
          <div class="stat-row"><span class="stat-label">Location</span><span class="stat-value" id="i${id}-ip-location">-</span></div>
          <div class="stat-row"><span class="stat-label">Organisation</span><span class="stat-value" id="i${id}-ip-org">-</span></div>
        </div>
      </div>

      <!-- VPN details card -->
      <div class="card">
        <div class="card-header">
            <div class="card-icon">&#128274;</div>
            <h3>VPN Connection</h3>
            <div class="stat-value"><button id="i${id}-btn-vpn-switch" class="btn-vpn-switch">&#9654; Switch VPN</button></div>
        </div>
        <div class="card-body">
          <div class="listboxContainer" id="listboxContainer">
            <div class="stat-row"><span class="stat-label">Provider</span><select id="i${id}-provider-select" class="dropdown"><option value="">Select Provider</option></select></div>
            <div class="providerContainer" id="providerContainer"> 
          </div>
          </div>
        </div>
      </div>

      <!-- Port forwarding card -->
      <div class="card">
        <div class="card-header">
          <span class="card-icon">&#128268;</span>
          <h3>Port Forwarding</h3>
        </div>
        <div class="card-body">
          <div class="stat-row"><span class="stat-label">Forwarded Port</span><span class="stat-value mono" id="i${id}-port-number">-</span></div>
        </div>
      </div>

      <!-- DNS card -->
      <div class="card">
        <div class="card-header">
          <span class="card-icon">&#128225;</span>
          <h3>DNS</h3>
        </div>
        <div class="card-body">
          <div class="stat-row"><span class="stat-label">Status</span><span class="stat-value" id="i${id}-dns-status">-</span></div>
        </div>
      </div>

      <!-- History card -->
      <div class="card card-wide">
        <div class="card-header">
          <span class="card-icon">&#128200;</span>
          <h3>Status History (last 30 polls)</h3>
        </div>
        <div class="card-body">
          <div class="history-track" id="i${id}-history-track"></div>
          <div class="history-legend">
            <span class="dot connected"></span> Connected &nbsp;
            <span class="dot paused"></span> Paused &nbsp;
            <span class="dot disconnected"></span> Disconnected &nbsp;
            <span class="dot unknown"></span> Unknown
          </div>
        </div>
      </div>
    </div>
  `;
	group.querySelector(`#i${id}-btn-start`).addEventListener('click', () => vpnAction(id, 'start'));
	group.querySelector(`#i${id}-btn-stop`).addEventListener('click', () => vpnAction(id, 'stop'));

	group.querySelector(`#i${id}-provider-select`).addEventListener('click', () => vpnProviderList(id)); 
	group.querySelector(`#i${id}-provider-select`).addEventListener('change', () => vpnProviderChange(id)); 

	group.querySelector(`#i${id}-btn-vpn-switch`).addEventListener('click', () => vpnSwitch(id)); 

	return group;

}


async function vpnProviderList(id) {
	const providerfiles = await getProviderFileList(); // gets a fresh list of providers from  /api/files
	const selection = document.getElementById(`i${id}-provider-select`);
	if (selection.options.length <= 1) {
		const selectMap = providerfiles.files.map(server => server.name);
		selectMap.sort((a, b) => a.name > b.name ? 1 : (a.name < b.name ? -2 : 0));
		const selectList = [...new Set(selectMap)];
		selectList.forEach(name => {
			const opt = document.createElement('option');
			opt.value = name;
			opt.textContent = name;
			selection.appendChild(opt);
			selection.disabled = false;
		});
	}
}

async function vpnProviderChange(id) {
	const selection = document.getElementById(`i${id}-provider-select`);
	await getSelectedProviderData(selection.value, id);
}

 async function vpnSwitch(id){
  let vpnProvider = document.getElementById(`i${id}-provider-select`).value;
  let vpnType;
  let vpnTU = '';
  let categoriesValue;
  let regionValue;
  let countryValue;
  let hostnameValue;
  let dataSwitch = {};
  let dataProvider = {};
  let dataSelect = {};
  let dataOpenvpn = {};
  let dataWireguard = {};
  let k,v;

  for (let i = 0; i < KEYS.length; i++) {
    k = KEYS[i];
    try {
      v = document.querySelector(`#select-${i}`).value;
    } catch  {
      v = "";
    }
console.log (k,v);
    if (v === null || v === undefined || v === "undefined") { v = '""' }
    if (k === 'vpn') { vpnType = v }
    if (k === "tcp" || k === "udp" ) { vpnTU = v } 
    if (k === "SWITCH" ) { vpnTU = "" }
    console.log(k,v,vpnTU);
    if (k === 'categories') { categoriesValue = v }
    if (k === 'region') { regionValue = v }
    if (k === 'country') { countryValue = v }
    if (k === 'city') { cityValue = v}
    if (k === 'hostname') { hostnameValue = v }
  }

// Openvpn Params
dataOpenvpn.config_file_path= "";
dataOpenvpn.protocol = vpnTU;
dataOpenvpn.endpoint_ip =  "0.0.0.0";
dataOpenvpn.custom_port = 0;
dataOpenvpn.pia_encryption_preset = "";

// wireguard params
dataWireguard.endpoint_ip = "0.0.0.0";
dataWireguard.endpoint_port = 0;
dataWireguard.public_key = "";

// server_selection params 
dataSelect.vpn = vpnType;
dataSelect.mode = "random";
if (categoriesValue.length > 0 ) { dataSelect.categories = [categoriesValue];} else { dataSelect.catagories = [];}
if (regionValue.length > 0 ) { dataSelect.regions = [regionValue];} else { dataSelect.regions = [];}
if (countryValue.length > 0 ) { dataSelect.countries = [countryValue];} else {dataSelect.countries = [];}
if (cityValue.length > 0)  {dataSelect.cities = [cityValue];} else {dataSelect.cities = [];}
if (hostnameValue.length > 0 ) {dataSelect.hostnames = [hostnameValue];} else { dataSelect.hostnames = [];}

dataSelect.openvpn = dataOpenvpn;
dataSelect.wireguard = dataWireguard;

// provider params
dataProvider.name = vpnProvider;
dataProvider.server_selection = dataSelect;

dataSwitch.type = vpnType;
dataSwitch.provider = dataProvider;


  let dataToSend = JSON.stringify(dataSwitch); 
  console.log(dataToSend);

  try {
    const res = await fetch(`/api/${id}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: dataToSend
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
//    newServer.textContent = newServer.options[(`i${id}-server-select`)].value;
    showToast(hostnameValue ? `Switching to ${hostnameValue}…` : 'Auto-selecting best server…', 'success');
  } catch (err) {
    console.error('[updateServer]', err.message);
    showToast(`Failed: ${err.message}`, 'error');
  }
}


function CreateListboxElements(id) {
  protocols.length = 0;
  protocols.push("");
  if (jsonkeys.includes('tcp')) {
    protocols.push('tcp');
    if ( !KEYS.includes('SWITCH')) { KEYS.splice(1, 0, 'SWITCH') } 
    if ( !KeyLabels.includes('tcpudp')) { KeyLabels.splice(1, 0, 'tcpudp') } 
  };
  if (jsonkeys.includes('udp')) {
    protocols.push('udp');
    if ( !KEYS.includes('SWITCH')) { KEYS.splice(1, 0, 'SWITCH') } 
    if ( !KeyLabels.includes('tcpudp')) { KeyLabels.splice(1, 0, 'tcpudp') } 
  };

console.log('Protocols:',protocols);
  let container = document.getElementById('providerContainer');
  container.innerHTML = '';
  
  KEYS.forEach((key, index) => {
    if ( !( `${key}` ===  "") ) {
      const wrapper = document.createElement('div');
	    wrapper.className = 'stat-row';
  	  wrapper.id = `i${index}-stat-row`;

	    const label = document.createElement('span');
  		label.className = 'stat-label';
      if (key === 'SWITCH')  {
		    label.textContent = `Tcp / Udp:`;
      } else {
    	  label.textContent = `${KeyLabels[index] + ':'}`;
      }

		  const select = document.createElement('select');
      if (key === 'SWITCH' )  {
	      select.id = `select-${index}`;
        select.dataset.index = KEYS[index];
      } else {
		    select.id = `select-${index}`;
        select.dataset.index = KEYS[index];
      }
	    select.className = 'dropdown';
  	  select.multiple = false; // Enables listbox view. Remove if you prefer standard dropdowns.
	    // Attach event listener: when any listbox changes, update all lower listboxes
		  select.addEventListener('change', () => updateCascade(index));
		  wrapper.appendChild(label);
  	  wrapper.appendChild(select);
	    container.appendChild(wrapper);
    }
	});

  if (KEYS.includes('SWITCH')) {
    let selsw = document.getElementById(`select-1`);
    let sw = KEYS.indexOf('SWITCH');
    // Populate the listbox with options
    const selopt = document.createElement("option");
    selopt.value = "";
    selopt.textContent = "";
    selopt.disabled = false; // Allow re-selection
    selopt.selected = true; // Show as default
    selsw.appendChild(selopt);
    protocols.forEach((opt, index) => {
      if (typeof opt !== "string" || opt.trim() === "") {
        console.warn(`Skipping invalid option at index ${index}`);
        return;
      }
      const options = document.createElement("option");
      options.value = opt;
      options.textContent = opt;
      selsw.appendChild(options);
    });
  }
}

// Helper function to normalise values into a flat array for unified handling
function matchesSelection(objectValue, selectedValue) {
	if (Array.isArray(objectValue)) {
		return objectValue.map(String).includes(selectedValue);
	}
	return String(objectValue) === selectedValue;
}

 
//////////////////////////
// 4. Cascade logic to update dropdown content sequentially
function updateCascade(startIndex, id) { // id to be added to all DOM elements later
	// If the top box changed, we pass -1 to clean/populate starting from index 0
	let currentFilteredDataset = jsondata;
  let selectBox;
  let selectedValue;
  let currentKey;
  
	// Track the criteria chosen in upper boxes to filter the dataset for lower boxes
	for (let i = 0; i <= startIndex; i++) {
  if (document.getElementById(`select-${i}`).value === "wireguard" ) {
      document.getElementById("select-1").selectedIndex = 0;
      document.getElementById("i1-stat-row").style.display = "none";
    } else {
      if (document.getElementById(`select-${i}`).value === "openvpn" ) {
        document.getElementById("i1-stat-row").style.display = "flex";
      }
    }
    selectBox = document.getElementById(`select-${i}`);
    currentKey = KEYS[i];
//    if (currentKey === 'SWITCH') {
    if (i === 1 ) {
      if (selectBox.value === null || selectBox.value === undefined || selectBox.value === "") {
        KEYS.splice(1,1,"SWITCH"); // KEYS[1] is the holding switch for either tcp OR udp, do not filter on both
        selectBox = document.getElementById(`select-${i}`);
        currentKey = KEYS[i];
        selectedValue = '';
      } else {
        KEYS.splice(1,1,`${selectBox.value}`);
        console.log('KI',KEYS[i]);
        currentKey = selectBox.value;
        selectedValue = "true";
      }
    } else {
      selectedValue = selectBox.value;
      currentKey = KEYS[i];
    }
    if (selectedValue) {
		  currentFilteredDataset = currentFilteredDataset.filter(item =>
		  	matchesSelection(item[currentKey], selectedValue));
		}
	}

	// Update all lower boxes sequentially based on the newly narrowed down dataset
  let i = startIndex + 1;
  let totalKeys = KEYS.length;
  while (i < totalKeys) {
    selectBox = document.getElementById(`select-${i}`);
    currentKey = KEYS[i];
    if ( selectBox === `select-1`) {
      if(selectBox.selectedIndex === 0) {
        KEYS.splice(1,1,"SWITCH");
        currentKey = KEYS[i];
        selectedValue = '';
      } else {
        KEYS.splice(1,1,`${selectBox.value}`);  // put either tcp OR udp into KEYS[1]
        currentKey = selectBox.value;
        selectedValue = "true";
      }
    }
//document.getElementById("select-1").selectedIndex = 0;
		// Save current selection to restore it if it's still available after refreshing
		let  previousSelection = selectedValue; // Not yet working  in commented code below, due to the tcp/udp switch
		const uniqueOptions = new Set();

		currentFilteredDataset.forEach(item => {
			let val = item[currentKey];
			if (Array.isArray(val)) {
				val.forEach(v => uniqueOptions.add(String(v)));
			} else if (val !== undefined && val !== null) {
				uniqueOptions.add(String(val));
			}
    });

/////////////////////////////////////////////////
// Not yet working correctly when changing tcp to udp or udp to tcp
// lower listboxes end up empty due to previous filtering
// if changing tcp to udp or udp to tcp  then need to recheck all lower filters
// at the same time clear the previous tcp or udp filter
// what is making this harder is the value for both tcp and udp is true in the providers json
// will next look at replacing the true's when importing and processing through the initial filter.

/*
  // Re-populate the listbox
		selectBox.innerHTML = '';

    if (i === 1 ) { 
      // Populate the listbox with options
      const selopt = document.createElement("option");
      selopt.value = "";
      selopt.textContent = "";
      selopt.disabled = false; // Allow re-selection
      selopt.selected = true; // Show as default
      selsw.appendChild(selopt);
      protocols.forEach((opt, index) => {
        if (typeof opt !== "string" || opt.trim() === "") {
          console.warn(`Skipping invalid option at index ${index}`);
          return;
        }
        const options = document.createElement("option");
        options.value = opt;
        options.textContent = opt;
        selsw.appendChild(options);
      });
      
    } else {

  		// Optional placeholder
  		if (uniqueOptions.size === 0) {
  			const opt = document.createElement('option');
  			opt.text = "-- No options available --";
  			opt.disabled = true;
  			selectBox.appendChild(opt);
  		}
  
  		uniqueOptions.forEach(optValue => {
        console.log('OV:', optValue);
  			const opt = document.createElement('option');
  			opt.value = optValue;
  			opt.textContent = optValue;
  
  			// Keep selection if valid
  			if (optValue === previousSelection) {
  				opt.selected = true;
  			}
  			selectBox.appendChild(opt);
  		}); 
    } */
/////////////////////////////////////////////////////////

    if ( selectBox.id !== "select-1" ) {  // temp fix while working on tcp udp switch
    selectBox.options.length = 1;
		sortedOptions = new Set([...uniqueOptions].sort());    
		sortedOptions.forEach(optValue => {
			let opt = document.createElement('option');
      opt.textContent = optValue;
  		opt.value = optValue;
      selectBox.appendChild(opt);
		});
  }
    i++;
  }

	// Further restrict dataset for the next lower box based on this box's current active value
	if (selectedValue) {
		currentFilteredDataset = currentFilteredDataset.filter(item => 
			matchesSelection(item[currentKey], selectedValue));       
	}
}

////////////////////////////////////////////////////////////////////////////////
function renderAllDashboards() {
	const container = $('dashboards-container');
	container.innerHTML = '';
	instances.forEach(inst => {
		container.appendChild(buildDashboardGroup(inst));
		renderHistoryFor(inst.id);
	});
	// Set grid columns: 1=full, 2=half, 3=third, 4=quarter
	const cols = Math.min(instances.length, 4) || 1;
	container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
}

// ---- Update a panel with health data ----

function updatePanel(inst, health) {
	const id = inst.id;
	const { vpnStatus, publicIp, portForwarded, dnsStatus, vpnSettings } = health;

	const d = vpnStatus?.ok ? vpnStatus.data : null;
	const s = vpnSettings?.ok ? vpnSettings.data : null;
	const ip = publicIp?.ok ? publicIp.data : null;

	const running = d?.status === 'running';
	const stopped = d?.status === 'stopped';
	const state = !vpnStatus?.ok ? 'unknown'
		 : running ? 'connected'
		 : stopped ? 'paused'
		 : 'disconnected';

	const banner = document.getElementById(`i${id}-banner`);
	if (banner)
		banner.className = `status-banner ${state}`;

	const pubIpStr = ip?.public_ip ?? ip?.ip ?? '';
	let sub = '';
	if (state === 'connected')
		sub = pubIpStr ? `Public IP: ${pubIpStr}` : 'Tunnel is up';
	else if (state === 'paused')
		sub = pubIpStr ? `Gluetun active - exit IP: ${pubIpStr}` : 'Gluetun active - VPN process stopped';
	else if (state === 'disconnected')
		sub = 'Tunnel is down - traffic may be unprotected';
	else
		sub = 'Could not reach Gluetun control API';
	const title = state === 'connected' ? 'VPN Connected'
		 : state === 'paused' ? 'VPN Paused'
		 : state === 'disconnected' ? 'VPN Disconnected'
		 : 'Status Unknown';
	setEl(`i${id}-banner-title`, title);
	setEl(`i${id}-banner-sub`, sub);

	setEl(`i${id}-ip-address`, ip?.public_ip ?? ip?.ip ?? ip?.IP ?? '-');
	setEl(`i${id}-ip-regions`, ip?.region ?? '-');
	setEl(`i${id}-ip-country`, ip?.country ?? '-');
	setEl(`i${id}-ip-city`, ip?.city ?? '-');
	setEl(`i${id}-ip-server`, ip?.hostname ?? s?.provider?.server_selection?.hostnames?.[0] ?? '-');
	setEl(`i${id}-ip-location`, ip?.location ?? '-');
	setEl(`i${id}-ip-org`, ip?.org ?? ip?.organization ?? '-');

	setEl(`i${id}-vpn-status`, d?.status ?? '-');
	setEl(`i${id}-vpn-provider`, s?.provider?.name ?? '-');
	setEl(`i${id}-vpn-protocol`, s?.type ?? '-');

  const port = portForwarded?.ok ? (portForwarded.data?.port ?? 0) : 0;
	setEl(`i${id}-port-number`, port > 0 ? String(port) : portForwarded?.ok ? 'Not forwarded' : 'N/A');

	setEl(`i${id}-dns-status`, dnsStatus?.ok ? (dnsStatus.data?.status ?? 'OK') : 'Unavailable');

	pushHistoryFor(id, state);
	renderHistoryFor(id);
}

function updatePanelError(inst) {
	const id = inst.id;
	const banner = document.getElementById(`i${id}-banner`);
	if (banner)
		banner.className = 'status-banner unknown';
	setEl(`i${id}-banner-title`, 'Status Unknown');
	setEl(`i${id}-banner-sub`, 'Could not reach Gluetun control API');
	setEl(`i${id}-ip-address`, '-');
	setEl(`i${id}-ip-country`, '-');
	setEl(`i${id}-ip-city`, '-');
	setEl(`i${id}-ip-org`, '-');
	setEl(`i${id}-vpn-status`, '-');
	setEl(`i${id}-vpn-provider`, '-');
	setEl(`i${id}-vpn-server`, '-');
	setEl(`i${id}-vpn-protocol`, '-');
	setEl(`i${id}-vpn-country`, '-');
	setEl(`i${id}-vpn-city`, '-');

	setEl(`i${id}-port-number`, 'N/A');
	setEl(`i${id}-dns-status`, 'Unavailable');
	pushHistoryFor(id, 'unknown');
	renderHistoryFor(id);
}

// ---- API ----

async function fetchHealth(instanceId) {
	const res = await fetch(`/api/${instanceId}/health`);
	if (!res.ok)
		throw new Error(`HTTP ${res.status}`);
	return res.json();
}

// ---- Poll all instances in parallel ----

async function pollAll() {
	if (isPolling)
		return;
	isPolling = true;
	const refreshBtn = $('refresh-btn');
	refreshBtn.innerHTML = '<span class="spin">&#x21bb;</span> Refresh';
	refreshBtn.disabled = true;

	await Promise.allSettled(instances.map(async inst => {
			try {
				const health = await fetchHealth(inst.id);
				updatePanel(inst, health);
				const id = inst.id;
				const currentprovider = health.vpnSettings.data.provider.name; // vpnSettings.data.provider.name
			} catch (_) {
				updatePanelError(inst);
			}
		}));

	setText('last-updated', `Updated ${new Date().toLocaleTimeString()}`);
	refreshBtn.innerHTML = '&#x21bb; Refresh';
	refreshBtn.disabled = false;
	isPolling = false;
}

// ---- VPN actions ----

async function vpnAction(instanceId, action) {
	const inst = instances.find(i => i.id === instanceId);
	const name = inst?.name ?? instanceId;
	const label = action === 'start' ? 'Starting' : 'Stopping';
	showToast(`${label} ${name}…`, 'info', 5000);
	try {
		const res = await fetch(`/api/${instanceId}/vpn/${action}`, {
			method: 'PUT'
		});
		const data = await res.json();
		if (data.ok) {
			showToast(`${name}: VPN ${action} command sent`, 'success');
			setTimeout(async() => {
				await pollAll();
				scheduleNextPoll();
			}, 2000);
		} else {
			showToast(`${name}: ${data.error ?? 'Unknown error'}`, 'error', 5000);
		}
	} catch (err) {
		showToast(`${name}: Request failed: ${err.message}`, 'error', 5000);
	}
}

// ---- Auto refresh ----

// Get the array of provider files
async function getProviderFileList() {
	let providerfiles = [];
	try {
		const res = await fetch('/api/files');
		if (!res.ok)
			throw new Error(`HTTP ${res.status}`);
		providerfiles = await res.json();
		return providerfiles;
	} catch (_) {
		providerfiles = [{
				id: '1',
				name: 'Error Cannot Fetch /api/files'
			}
		];
		return;
	}
}


// Get the JSON contents of the selected providers file
async function getSelectedProviderData(provdata, id) {
  let KEYS2 = []; // temp holder for valid provider keys keeping correct order
  let KeyLabels2 = []; // temp holder for valid provider labels keeping correct order
	// const prov = ( provdata !== "nordvpn") ? provdata : "nordvpn"; // set nordvpn as default provider
	try {
		const res = await fetch(`/api/data/${provdata}`);
		if (!res.ok)
			throw new Error(`HTTP ${res.status}`);
		jsondata = await res.json(); // get array of providers objects from the api into serverlist []
    if ( jsonkeys.length > 0 ) {jsonkeys.length = 0;}
    get_all_json_keys(jsondata, jsonkeys); // get the providers object keys for enabling options into jsonkeys []

    KEYS2.length = 0;
    KeyLabels2.length = 0;
    KEYS.length = 0; // KEYS2 after Boolean removing empty elements
    KeyLabels.length = 0; // KeyLabels2 after Boolean removing empty elements

	  jsonkeys.forEach((key, index) => {
      if ( proKeys.includes(key) ) {
        let idx = proKeys.indexOf(key); 
        KEYS2[idx] = key;
        let lbl = proLabels[idx];
        KeyLabels2[idx] = lbl;
      }
    });
    KEYS=KEYS2.filter(Boolean);
    KeyLabels=KeyLabels2.filter(Boolean);

  	CreateListboxElements(id); // add id (not  working yet, need to add id to DOM elements) param then can address rows per id by adding the id to the auto generated stat rowss

		// populate Listboxes
		updateCascade(-1, id); // again id not working yet, need to add id to DOM elements
		return; 
	} catch (_) {
		showToast(`Request failed: Error Cannot Fetch /api/data/${provdata}`, 'error', 5000);
	}
}

async function get_all_json_keys(jsonObject, retArray = []) {
  try {
    // Validate input
    if (typeof jsonObject !== 'object' || jsonObject === null) {
      throw new TypeError("Input must be a non-null object or array");
    }
    // Iterate over object keys
    Object.keys(jsonObject).forEach(key => {
      if (!retArray.includes(key) && isNaN(key)) {
        retArray.push(key);
      }
      const value = jsonObject[key];
      // Recursively handle nested objects/arrays
      if (typeof value === 'object' && value !== null) {
        get_all_json_keys(value, retArray);
      }
    });

    return retArray;
  } catch (err) {
    console.error("Error in get_all_json_keys:", err.message);
    return [];
  }
}


function scheduleNextPoll() {
	clearTimeout(refreshTimer);
	const interval = parseInt($('refresh-interval').value, 10);
	if (interval > 0) {
		refreshTimer = setTimeout(async() => {
			await pollAll();
			scheduleNextPoll();
		}, interval);
	}
}

function applyAutoRefresh() {
	clearTimeout(refreshTimer);
	scheduleNextPoll();
}

// ---- Init ----

$('refresh-btn').addEventListener('click', () => {
	clearTimeout(refreshTimer);
	pollAll().then(() => scheduleNextPoll());
});
$('refresh-interval').addEventListener('change', applyAutoRefresh);

(async() => {
	try {
		const res = await fetch('/api/instances');
		if (!res.ok)
			throw new Error(`HTTP ${res.status}`);
		instances = await res.json();
		console.log('INST', instances);
	} catch (_) {
		instances = [{
				id: '1',
				name: 'Gluetun'
			}
		];
	}

	renderAllDashboards();
	await pollAll();
	scheduleNextPoll();
})();
