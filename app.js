/**
 * Amway IBO Compensation Calculator — app.js
 * Full bonus engine with growth calculator and projected sections.
 */

// ============================================================
//  CONSTANTS
// ============================================================

const DEFAULT_PV_TO_BV    = 3.00;
const DEFAULT_LEG_PV      = 150;
const STORAGE_KEY         = 'amway_bonus_calc_v6';

const PERF_BONUS_BRACKETS = [
  { minPV: 7500, pct: 0.25, label: '7,500' },
  { minPV: 6000, pct: 0.23, label: '6,000' },
  { minPV: 4000, pct: 0.21, label: '4,000' },
  { minPV: 2500, pct: 0.18, label: '2,500' },
  { minPV: 1500, pct: 0.15, label: '1,500' },
  { minPV: 1000, pct: 0.12, label: '1,000' },
  { minPV: 600,  pct: 0.09, label: '600' },
  { minPV: 300,  pct: 0.06, label: '300' },
  { minPV: 100,  pct: 0.03, label: '100' },
];

const CSI_PCT              = 0.10;
const RETAIL_MARGIN_PCT    = 0.10;
const LEADERSHIP_BONUS_PCT = 0.06;
const DEPTH_BONUS_PCT      = 0.01;
const BRONZE_FOUNDATION_PCT = 0.30;
const BRONZE_BUILDER_PCT    = 0.40;
const PERF_PLUS_PCT        = 0.02;
const PERF_ELITE_PCT       = 0.04;
const RUBY_BONUS_PCT       = 0.02;
const PROFIT_SHARING_PCT   = 0.0025;

// ============================================================
//  HELPERS
// ============================================================

function fmtUSD(n) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtNum(n) { return Math.round(n).toLocaleString('en-US'); }
function parseNum(v) { const n = parseFloat(v); return isNaN(n) || n < 0 ? 0 : n; }
function getBracket(pv) {
  for (let i = 0; i < PERF_BONUS_BRACKETS.length; i++) {
    if (pv >= PERF_BONUS_BRACKETS[i].minPV) return PERF_BONUS_BRACKETS[i];
  }
  return { minPV: 0, pct: 0, label: '0-99' };
}
function escAttr(s) { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ============================================================
//  CALCULATOR ENGINE
// ============================================================

class CalcEngine {
  constructor() {
    this.pvToBv = DEFAULT_PV_TO_BV;
    this.defaultLegPv = DEFAULT_LEG_PV;
    this.legIdCounter = 0;
    this.legMap = new Map();
    this.topLevelLegs = [];
    this.collapsedLegs = new Set();
    this.personalPV = 0;
    this.personalVcsPV = 0;
    this.iboLevel = 'full';
  }

  _migrateIboLevel(val) {
    if (val === 'full' || val === 'bronzeOnly' || val === 'none') return val;
    if (val === 'new') return 'full';
    if (val === 'belowGold' || val === 'below12') return 'bronzeOnly';
    if (val === 'standard') return 'none';
    return 'full';
  }

  createLeg(name, pv, vcsPv, type) {
    const id = this.legIdCounter++;
    this.legMap.set(id, { id, name: name || 'Unnamed', pv: pv || 0, vcsPv: vcsPv, type: type || 'standard', children: [] });
    return id;
  }

  sumTreePV(ids) {
    let s = 0;
    ids.forEach(id => { const n = this.legMap.get(id); if (n) { s += n.pv + this.sumTreePV(n.children); } });
    return s;
  }

  sumTreeBV(ids) { return this.sumTreePV(ids) * this.pvToBv; }

  removeLeg(legId) {
    const node = this.legMap.get(legId);
    if (!node) return;
    node.children.forEach(cid => this.removeLeg(cid));
    this.legMap.delete(legId);
  }

  serializeLeg(id) {
    const n = this.legMap.get(id); if (!n) return null;
    return { id: n.id, name: n.name, pv: n.pv, vcsPv: n.vcsPv || 0, type: n.type || 'standard', children: n.children.map(c => this.serializeLeg(c)).filter(Boolean) };
  }

  serializeAll() {
    const legs = [];
    this.topLevelLegs.forEach(id => legs.push(this.serializeLeg(id)));
    return { pvToBv: this.pvToBv, defaultLegPv: this.defaultLegPv, personalPV: this.personalPV, personalVcsPV: this.personalVcsPV, iboLevel: this.iboLevel, legs, collapsedLegs: Array.from(this.collapsedLegs) };
  }

  deserializeAll(data) {
    this.pvToBv = (typeof data.pvToBv === 'number' && data.pvToBv > 0) ? data.pvToBv : DEFAULT_PV_TO_BV;
    this.defaultLegPv = (typeof data.defaultLegPv === 'number' && data.defaultLegPv >= 0) ? data.defaultLegPv : DEFAULT_LEG_PV;
    this.personalPV = typeof data.personalPV === 'number' ? data.personalPV : 0;
    this.personalVcsPV = typeof data.personalVcsPV === 'number' ? data.personalVcsPV : 0;
    this.iboLevel = this._migrateIboLevel(data.iboLevel);
    this.legMap.clear(); this.topLevelLegs = []; this.legIdCounter = 0;
    if (Array.isArray(data.legs)) {
      data.legs.forEach(t => { const lid = this.deserializeLeg(t); if (lid !== null) this.topLevelLegs.push(lid); });
    }
    this.collapsedLegs.clear();
    if (Array.isArray(data.collapsedLegs)) data.collapsedLegs.forEach(id => this.collapsedLegs.add(id));
  }

  deserializeLeg(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const id = (typeof obj.id === 'number') ? obj.id : this.legIdCounter++;
    this.legIdCounter = Math.max(this.legIdCounter, id + 1);
    const name = typeof obj.name === 'string' ? obj.name : 'Unnamed';
    const pv = typeof obj.pv === 'number' ? obj.pv : 0;
    const vcsPv = typeof obj.vcsPv === 'number' ? obj.vcsPv : 0;
    const type = typeof obj.type === 'string' && ['standard','core','prosumer','strongRetail'].includes(obj.type) ? obj.type : 'standard';
    const children = [];
    if (Array.isArray(obj.children)) obj.children.forEach(c => { const cid = this.deserializeLeg(c); if (cid !== null) children.push(cid); });
    this.legMap.set(id, { id, name, pv, vcsPv, type, children });
    return id;
  }

  collectLegData(legId) {
    const node = this.legMap.get(legId); if (!node) return null;
    const subLegs = []; let totalPV = node.pv;
    node.children.forEach(cid => { const sub = this.collectLegData(cid); if (sub) { subLegs.push(sub); totalPV += sub.totalPV; } });
    return { id: node.id, name: node.name, ownPV: node.pv, totalPV, totalBV: totalPV * this.pvToBv, subLegs };
  }

  // Helper: compute group PV (own + non-qualified descendants) and breakaway PV (qualified descendants)
  // for a given leg. Used by both earnings calculation and display columns.
  calcLegVolume(legId) {
    const node = this.legMap.get(legId);
    if (!node) return { groupPV: 0, breakawayPV: 0, totalDownlinePV: 0 };
    let groupPV = node.pv;
    let breakawayPV = 0;
    let totalDownlinePV = 0;
    node.children.forEach(cid => {
      const cn = this.legMap.get(cid);
      if (!cn) return;
      const childTotalPV = cn.pv + this.sumTreePV(cn.children);
      totalDownlinePV += childTotalPV;
      if (getBracket(childTotalPV).pct >= 0.25) {
        breakawayPV += childTotalPV;
      } else {
        groupPV += childTotalPV;
      }
    });
    return { groupPV, breakawayPV, totalDownlinePV };
  }

  // ============================================================
  //  UNIFIED EARNINGS CALCULATION
  //  Single source of truth for all IBO earnings (personal + downline)
  // ============================================================

  // Core earnings calculator — works for any IBO (you or any downline leg)
  // childLegData: [{id, totalPV, totalBV, subLegs}] — pre-computed by tree walker
  // returns: {monthly, yearly, netBonus, perfBonus, diffBonus, retailMargin, csi, bonuses, qual, ...}
  _calcEarnings(ownPV, ownVcsPV, iboLevel, pvToBv, childLegData, totalAllDownlineBV) {
    const ownBV = ownPV * pvToBv;

    // Separate children into qualified (25% bracket) and non-qualified
    const qual25Legs = childLegData.filter(l => getBracket(l.totalPV).pct >= 0.25);
    const non25Legs = childLegData.filter(l => getBracket(l.totalPV).pct < 0.25);

    // Group PV excludes qualified leg volume (they are pass-through / side volume)
    const groupPV = ownPV + non25Legs.reduce((s, l) => s + l.totalPV, 0);
    const groupBV = groupPV * pvToBv;
    const bracket = getBracket(groupPV);
    const groupPct = bracket.pct;

    // VCS: use explicit vcsPV if set (>0), otherwise default to ownPV (100% customer)
    // This matches the personal IBO behavior where VCS defaults to personal PV
    const vcsPV = (ownVcsPV && ownVcsPV > 0) ? ownVcsPV : ownPV;
    const vcsBV = vcsPV * pvToBv;
    const vcsPct = ownPV > 0 ? vcsPV / ownPV : 0;
    const customerPct = vcsPct;
    const rule412Met = customerPct >= 0.70 && vcsPct >= 0.60;
    const r412Factor = rule412Met ? 1.0 : (customerPct > 0 ? Math.min(1.0, customerPct / 0.70) : 0);

    const retailMargin = ownBV * RETAIL_MARGIN_PCT;
    const csi = groupPct < 0.10 ? vcsBV * Math.max(0, CSI_PCT - groupPct) : 0;
    const perfBonus = ownBV * groupPct * r412Factor;

    // Differential: use adjusted groupPct vs each child's bracket
    let diffBonus = 0;
    childLegData.forEach(child => { const cb = getBracket(child.totalPV); const d = groupPct - cb.pct; if (d > 0) diffBonus += child.totalBV * d; });

    const bfLegs100 = childLegData.filter(l => l.totalPV >= 100).length;
    const bfBase = perfBonus + diffBonus;
    const bfEligible = groupPV >= 600 && bfLegs100 >= 3 && iboLevel === 'full' && vcsPct >= 0.60;
    const bronzeFoundation = bfEligible ? bfBase * BRONZE_FOUNDATION_PCT : 0;
    const bbLegs300 = childLegData.filter(l => l.totalPV >= 300).length;
    const bbEligible = groupPV >= 2500 && bbLegs300 >= 3 && (iboLevel === 'full' || iboLevel === 'bronzeOnly') && vcsPct >= 0.60;
    const bronzeBuilder = bbEligible ? bfBase * BRONZE_BUILDER_PCT : 0;

    // Ruby uses non-qualified volume (same as groupPV)
    const rubyPV = groupPV;
    const rubyBV = groupBV;
    let perfPlus = 0, perfElite = 0, rubyBonus = 0;
    if (rubyPV >= 12500) { perfElite = rubyBV * PERF_ELITE_PCT; } else if (rubyPV >= 10000) { perfPlus = rubyBV * PERF_PLUS_PCT; }
    if (rubyPV >= 15000) { rubyBonus = rubyBV * RUBY_BONUS_PCT; }

    // Leadership Bonus: uses qualified legs' BV, with outside-PV check
    let leadershipBonus = 0;
    if (qual25Legs.length >= 2) {
      qual25Legs.forEach(l => { leadershipBonus += l.totalBV * LEADERSHIP_BONUS_PCT; });
    } else if (qual25Legs.length === 1) {
      if (groupPV >= 2500) leadershipBonus += qual25Legs[0].totalBV * LEADERSHIP_BONUS_PCT;
    }

    let depthBonus = 0;
    if (qual25Legs.length >= 3) {
      qual25Legs.forEach(ql => {
        if (ql.subLegs) { ql.subLegs.forEach(sl => { if (getBracket(sl.totalPV).pct >= 0.25) depthBonus += sl.totalBV * DEPTH_BONUS_PCT; }); }
      });
    }

    // Yearly bonuses: SS requires 150+ own PV to qualify
    let yearlyBonus = 0;
    if (iboLevel === 'full' && ownPV >= 150) yearlyBonus += 1000;
    const legs7500 = childLegData.filter(l => l.totalPV >= 7500).length;
    if (legs7500 >= 2) yearlyBonus += 10000;
    if (legs7500 >= 3) yearlyBonus += 7500;
    if (legs7500 >= 6) yearlyBonus += 15000;
    if (legs7500 >= 3) yearlyBonus += (totalAllDownlineBV || 0) * PROFIT_SHARING_PCT * 12;
    if (legs7500 >= 6) yearlyBonus += (totalAllDownlineBV || 0) * PROFIT_SHARING_PCT * 12;

    const netBonus = perfBonus + diffBonus + bronzeFoundation + bronzeBuilder + perfPlus + perfElite + rubyBonus + leadershipBonus + depthBonus;
    const monthlyEarnings = netBonus + retailMargin + csi + (yearlyBonus / 12);

    // Qualification flags
    const isSilver = groupPV >= 7500 || childLegData.some(l => { const outside = groupPV - l.totalPV; return getBracket(l.totalPV).pct >= 0.25 && outside >= 2500; }) || childLegData.filter(l => getBracket(l.totalPV).pct >= 0.25).length >= 2;
    const isEmerald = isSilver && qual25Legs.length >= 3;
    const isDiamond = qual25Legs.length >= 6;
    const pqMonth = rubyPV >= 7500 || childLegData.some(l => { const outside = rubyPV - l.totalPV; return getBracket(l.totalPV).pct >= 0.25 && outside >= 4000; });
    const fqCount = qual25Legs.length;
    const ssiEligible = iboLevel === 'full' && ownPV >= 150;
    const lbEligible = qual25Legs.length >= 2 || (qual25Legs.length === 1 && groupPV >= 2500);
    let dbEligible = false;
    if (qual25Legs.length >= 3) { dbEligible = qual25Legs.some(leg => leg.subLegs && leg.subLegs.some(sl => getBracket(sl.totalPV).pct >= 0.25)); }

    const qual = { isSilver, isEmerald, isDiamond, pqMonth, fqCount, qual25LegsCount: qual25Legs.length, rubyPV, bfEligible, bbEligible, ssiEligible, lbEligible, dbEligible, bfLegs100: bfLegs100, bbLegs300: bbLegs300, legs7500, bracket: bracket.pct, totalGroupPV: groupPV };

    const bonuses = {
      retailMargin, csi, personalPerfBonus: perfBonus, differentialBonus: diffBonus,
      bronzeFoundation, bronzeBuilder, perfPlus, perfElite, rubyBonus, leadershipBonus, depthBonus,
    };

    return { monthly: monthlyEarnings, yearly: yearlyBonus, netBonus, perfBonus, diffBonus, retailMargin, csi, bonuses, qual, rule412Met, customerPct, vcsPct, groupPV, groupBV, groupPct, groupBracket: bracket };
  }

  // Tree walker: computes earnings for every node bottom-up
  // Stores results on each node._earnings
  // Returns the personal (top-level) result
  _computeAllEarnings() {
    this._earningsMap = new Map();

    // Recursive function: computes earnings for a single node, walking children first
    const computeNode = (nodeId, depth) => {
      const node = this.legMap.get(nodeId);
      if (!node) return null;

      // First, recursively compute all children (bottom-up)
      const childLegData = [];
      let totalAllDownlineBV = 0;
      node.children.forEach(cid => {
        const childResult = computeNode(cid, depth + 1);
        if (childResult) {
          childLegData.push(childResult);
          totalAllDownlineBV += childResult.totalBV;
        }
      });

      // Determine VCS: use node.vcsPv if explicitly set (>0), otherwise default to ownPV
      const ownVcsPV = (node.vcsPv && node.vcsPv > 0) ? node.vcsPv : node.pv;

      const result = this._calcEarnings(
        node.pv, ownVcsPV, this.iboLevel, this.pvToBv, childLegData, totalAllDownlineBV
      );

      // Store on node and in map
      node._earnings = result;
      node._childLegData = childLegData;
      node._totalAllDownlineBV = totalAllDownlineBV;
      this._earningsMap.set(nodeId, result);

      // Return data needed by parent
      const totalPV = node.pv + childLegData.reduce((s, c) => s + c.totalPV, 0);
      return { id: nodeId, totalPV, totalBV: totalPV * this.pvToBv, subLegs: childLegData };
    };

    // Compute all top-level legs
    const topLevelData = [];
    let totalAllDownlineBV = 0;
    this.topLevelLegs.forEach(id => {
      const d = computeNode(id, 0);
      if (d) { topLevelData.push(d); totalAllDownlineBV += d.totalBV; }
    });

    // Now compute personal earnings using the same function
    const personalResult = this._calcEarnings(
      this.personalPV, this.personalVcsPV, this.iboLevel, this.pvToBv, topLevelData, totalAllDownlineBV
    );

    // Build legDataList for backward compatibility (used by renderQualificationStatus)
    const legDataList = [];
    const collectLegData = (nodeId) => {
      const node = this.legMap.get(nodeId);
      if (!node) return null;
      const subLegs = [];
      node.children.forEach(cid => { const sub = collectLegData(cid); if (sub) subLegs.push(sub); });
      const totalPV = node.pv + subLegs.reduce((s, l) => s + l.totalPV, 0);
      return { id: nodeId, name: node.name, ownPV: node.pv, totalPV, totalBV: totalPV * this.pvToBv, subLegs };
    };
    this.topLevelLegs.forEach(id => { const d = collectLegData(id); if (d) legDataList.push(d); });

    return {
      personalPV: this.personalPV,
      personalVcsPV: this.personalVcsPV,
      personalBV: this.personalPV * this.pvToBv,
      totalGroupPV: personalResult.groupPV,
      totalGroupBV: personalResult.groupBV,
      groupBracket: personalResult.groupBracket,
      groupPct: personalResult.groupPct,
      bonuses: personalResult.bonuses,
      netBonus: personalResult.netBonus,
      totalEarnings: personalResult.monthly,
      qual: personalResult.qual,
      rule412Met: personalResult.rule412Met,
      customerPct: personalResult.customerPct,
      vcsPct: personalResult.vcsPct,
      iboLevel: this.iboLevel,
      yearlyBonus: personalResult.yearly,
      legDataList,
      totalAllDownlineBV,
    };
  }

  // Public: compute earnings for a single downline leg (used by row display)
  // Always recomputes fresh from current tree state
  calculateLegEarnings(legId) {
    const node = this.legMap.get(legId);
    if (!node) return { monthly: 0, yearly: 0, netBonus: 0, perfBonus: 0, diffBonus: 0, retailMargin: 0, csi: 0 };

    // Build childLegData from current tree state (recursive totalPV for each child)
    const buildChildData = (childId) => {
      const cn = this.legMap.get(childId);
      if (!cn) return null;
      const subLegs = [];
      cn.children.forEach(cid => { const sub = buildChildData(cid); if (sub) subLegs.push(sub); });
      const totalPV = cn.pv + subLegs.reduce((s, l) => s + l.totalPV, 0);
      return { id: childId, totalPV, totalBV: totalPV * this.pvToBv, subLegs };
    };
    const childLegData = [];
    let totalAllDownlineBV = 0;
    node.children.forEach(cid => {
      const d = buildChildData(cid);
      if (d) { childLegData.push(d); totalAllDownlineBV += d.totalBV; }
    });

    const ownVcsPV = (node.vcsPv && node.vcsPv > 0) ? node.vcsPv : node.pv;
    const result = this._calcEarnings(node.pv, ownVcsPV, this.iboLevel, this.pvToBv, childLegData, totalAllDownlineBV);
    return { monthly: result.monthly, yearly: result.yearly, netBonus: result.netBonus, perfBonus: result.perfBonus, diffBonus: result.diffBonus, retailMargin: result.retailMargin, csi: result.csi };
  }

  // Public: compute personal earnings (used by Performance Summary)
  calcPersonal() {
    return this._computeAllEarnings();
  }
}

// Global engines
const liveEngine = new CalcEngine();
let projEngine = null;

// ============================================================
//  DOM CACHING
// ============================================================

let $personalPV, $personalVcsPV, $personalBVDisplay,
    $downlineContainer, $addLegBtn, $legCount,
    $totalGroupPV, $totalGroupBV, $qualifyingPct, $bracketBar,
    $bracketGrid, $bonusBreakdownBody, $groupEarningsDisplay,
    $qualificationBody,
    $pvToBvInput, $defaultLegPvInput, $bulkCountInput,
    $bulkAddBtn, $resetBtn, $saveIndicator,
    $iboLevelSelect,
    $exportBtn, $importBtn, $importFileInput;

let $groupMonthlyPayout, $groupAnnualPayout;

let $growthFrontline, $growthSlow, $growthCustomerPv, $growthMaxPv, $growthMonths, $growthRunBtn, $growthClearBtn, $growthExportBtn;
let $collapseAllBtn, $expandAllBtn, $projCollapseAllBtn, $projExpandAllBtn;

let $projPanel, $projPersonalPV, $projPersonalVcsPV, $projPersonalBVDisplay,
    $projDownlineContainer, $projAddLegBtn, $projLegCount,
    $projTotalGroupPV, $projTotalGroupBV, $projQualifyingPct, $projBracketBar,
    $projBracketGrid, $projBonusBreakdownBody, $projGroupEarningsDisplay,
    $projQualificationBody,
    $projIboLevelSelect;

let $projGroupMonthlyPayout, $projGroupAnnualPayout;

function cacheDOM() {
  $personalPV           = document.getElementById('personalPV');
  $personalVcsPV        = document.getElementById('personalVcsPV');
  $personalBVDisplay    = document.getElementById('personalPVBV');
  $downlineContainer    = document.getElementById('downlineContainer');
  $addLegBtn            = document.getElementById('addLegBtn');
  $legCount             = document.getElementById('legCount');
  $totalGroupPV         = document.getElementById('totalGroupPV');
  $totalGroupBV         = document.getElementById('totalGroupBV');
  $qualifyingPct        = document.getElementById('qualifyingPct');
  $bracketBar           = document.getElementById('bracketBar');
  $bracketGrid          = document.getElementById('bracketGrid');
  $bonusBreakdownBody   = document.getElementById('bonusBreakdownBody');
  $groupEarningsDisplay = document.getElementById('groupEarningsDisplay');
  $qualificationBody    = document.getElementById('qualificationBody');
  $pvToBvInput          = document.getElementById('pvToBvInput');
  $defaultLegPvInput    = document.getElementById('defaultLegPvInput');
  $bulkCountInput       = document.getElementById('bulkCountInput');
  $bulkAddBtn           = document.getElementById('bulkAddBtn');
  $resetBtn             = document.getElementById('resetBtn');
  $saveIndicator        = document.getElementById('saveIndicator');
  $iboLevelSelect       = document.getElementById('iboLevelSelect');
  $exportBtn            = document.getElementById('exportBtn');
  $importBtn            = document.getElementById('importBtn');
  $importFileInput      = document.getElementById('importFileInput');

  $growthFrontline      = document.getElementById('growthFrontline');
  $growthSlow           = document.getElementById('growthSlow');
  $growthCustomerPv     = document.getElementById('growthCustomerPv');
  $growthMaxPv          = document.getElementById('growthMaxPv');
  $growthMonths         = document.getElementById('growthMonths');
  $growthRunBtn         = document.getElementById('growthRunBtn');
  $growthClearBtn       = document.getElementById('growthClearBtn');
  $growthExportBtn      = document.getElementById('growthExportBtn');

  $collapseAllBtn       = document.getElementById('collapseAllBtn');
  $expandAllBtn         = document.getElementById('expandAllBtn');
  $projCollapseAllBtn   = document.getElementById('projCollapseAllBtn');
  $projExpandAllBtn     = document.getElementById('projExpandAllBtn');

  $projPanel            = document.getElementById('projPanel');
  $projPersonalPV       = document.getElementById('projPersonalPV');
  $projPersonalVcsPV    = document.getElementById('projPersonalVcsPV');
  $projPersonalBVDisplay= document.getElementById('projPersonalBVDisplay');
  $projDownlineContainer= document.getElementById('projDownlineContainer');
  $projAddLegBtn        = document.getElementById('projAddLegBtn');
  $projLegCount         = document.getElementById('projLegCount');
  $projTotalGroupPV     = document.getElementById('projTotalGroupPV');
  $projTotalGroupBV     = document.getElementById('projTotalGroupBV');
  $projQualifyingPct    = document.getElementById('projQualifyingPct');
  $projBracketBar       = document.getElementById('projBracketBar');
  $projBracketGrid      = document.getElementById('projBracketGrid');
  $projBonusBreakdownBody= document.getElementById('projBonusBreakdownBody');
  $projGroupEarningsDisplay= document.getElementById('projGroupEarningsDisplay');
  $projQualificationBody= document.getElementById('projQualificationBody');
  $projIboLevelSelect   = document.getElementById('projIboLevelSelect');

  $groupMonthlyPayout   = document.getElementById('groupMonthlyPayout');
  $groupAnnualPayout    = document.getElementById('groupAnnualPayout');
  $projGroupMonthlyPayout = document.getElementById('projGroupMonthlyPayout');
  $projGroupAnnualPayout  = document.getElementById('projGroupAnnualPayout');
}

// ============================================================
//  LOCALSTORAGE (live engine only)
// ============================================================

function buildSavePayload() {
  const legs = [];
  liveEngine.topLevelLegs.forEach(id => legs.push(liveEngine.serializeLeg(id)));
  return {
    version: 6, pvToBv: liveEngine.pvToBv, defaultLegPv: liveEngine.defaultLegPv,
    personalPV: $personalPV ? parseNum($personalPV.value) : 0,
    personalVcsPV: $personalVcsPV ? parseNum($personalVcsPV.value) : 0,
    iboLevel: $iboLevelSelect ? $iboLevelSelect.value : 'full',
    legs, collapsedLegs: Array.from(liveEngine.collapsedLegs),
    growthFrontline: $growthFrontline ? parseNum($growthFrontline.value) : 1,
    growthSlow: $growthSlow ? parseNum($growthSlow.value) : 0.5,
    growthCustomerPv: $growthCustomerPv ? parseNum($growthCustomerPv.value) : 25,
    growthMaxPv: $growthMaxPv ? parseNum($growthMaxPv.value) : 1000,
    growthMonths: $growthMonths ? parseNum($growthMonths.value) : 12,
  };
}
function saveState() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(buildSavePayload())); flashSaveIndicator(); } catch(_){} }
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return false;
    const data = JSON.parse(raw); if (!data || typeof data !== 'object') return false;
    liveEngine.pvToBv = (typeof data.pvToBv==='number' && data.pvToBv>0) ? data.pvToBv : DEFAULT_PV_TO_BV;
    liveEngine.defaultLegPv = (typeof data.defaultLegPv==='number' && data.defaultLegPv>=0) ? data.defaultLegPv : DEFAULT_LEG_PV;
    if ($personalPV && typeof data.personalPV==='number') $personalPV.value = data.personalPV || '';
    if ($personalVcsPV && typeof data.personalVcsPV==='number') $personalVcsPV.value = data.personalVcsPV || '';
    if ($iboLevelSelect && data.iboLevel) $iboLevelSelect.value = data.iboLevel;
    liveEngine.legMap.clear(); liveEngine.topLevelLegs = []; liveEngine.legIdCounter = 0;
    if (Array.isArray(data.legs)) data.legs.forEach(t=>{ const lid=liveEngine.deserializeLeg(t); if(lid!==null) liveEngine.topLevelLegs.push(lid); });
    liveEngine.collapsedLegs.clear();
    if (Array.isArray(data.collapsedLegs)) data.collapsedLegs.forEach(id=>liveEngine.collapsedLegs.add(id));
    // Restore growth settings
    if ($growthFrontline && typeof data.growthFrontline==='number') $growthFrontline.value = data.growthFrontline;
    if ($growthSlow && typeof data.growthSlow==='number') $growthSlow.value = data.growthSlow;
    if ($growthCustomerPv && typeof data.growthCustomerPv==='number') $growthCustomerPv.value = data.growthCustomerPv;
    if ($growthMaxPv && typeof data.growthMaxPv==='number') $growthMaxPv.value = data.growthMaxPv;
    if ($growthMonths && typeof data.growthMonths==='number') $growthMonths.value = data.growthMonths;
    return true;
  } catch(_){ return false; }
}
function resetToDefaults() {
  localStorage.removeItem(STORAGE_KEY);
  liveEngine.pvToBv=DEFAULT_PV_TO_BV; liveEngine.defaultLegPv=DEFAULT_LEG_PV; liveEngine.legIdCounter=0; liveEngine.legMap.clear(); liveEngine.topLevelLegs=[]; liveEngine.collapsedLegs.clear();
  $personalPV.value=''; if($personalVcsPV) $personalVcsPV.value='';
  if($iboLevelSelect) $iboLevelSelect.value='full';
  renderSettings(); rebuildAllLegs($downlineContainer, liveEngine, $legCount); recalculate();
}
function flashSaveIndicator() {
  if(!$saveIndicator) return;
  $saveIndicator.textContent='Saved'; $saveIndicator.classList.remove('opacity-0'); $saveIndicator.classList.add('opacity-100');
  clearTimeout(flashSaveIndicator._timer);
  flashSaveIndicator._timer=setTimeout(()=>{ $saveIndicator.classList.remove('opacity-100'); $saveIndicator.classList.add('opacity-0'); },1500);
}

// ============================================================
//  SETTINGS
// ============================================================

function renderSettings() {
  if($pvToBvInput) $pvToBvInput.value=liveEngine.pvToBv.toFixed(2);
  if($defaultLegPvInput) $defaultLegPvInput.value=liveEngine.defaultLegPv;
  const el=document.getElementById('ratioDisplay'); if(el) el.textContent=liveEngine.pvToBv.toFixed(2);
}
function onSettingsChange() {
  const r=parseNum($pvToBvInput.value); liveEngine.pvToBv=r>0?r:DEFAULT_PV_TO_BV;
  const d=parseNum($defaultLegPvInput.value); liveEngine.defaultLegPv=d>=0?d:DEFAULT_LEG_PV;
  renderSettings(); recalculate(); saveState();
}

// ============================================================
//  LEG TREE RENDERING (works with any engine via parameter)
// ============================================================

function refreshLegRowDisplays(legId, engine, container) {
  const node=engine.legMap.get(legId); if(!node) return;
  const row=document.querySelector(`.leg-row[data-leg-id="${legId}"]`); if(!row) return;
  const vol=engine.calcLegVolume(legId);
  const totalDownlinePV=vol.totalDownlinePV;
  const bv=node.pv*engine.pvToBv;
  const $bv=row.querySelector('.leg-bv'); if($bv) $bv.textContent=fmtUSD(bv);
  const $group=row.querySelector('.leg-group-pv'); if($group) $group.textContent=vol.groupPV>0?fmtNum(vol.groupPV)+' PV':'—';
  const $break=row.querySelector('.leg-breakaway-pv'); if($break) $break.textContent=vol.breakawayPV>0?fmtNum(vol.breakawayPV)+' PV':'—';
  const $tot=row.querySelector('.leg-total-pv'); if($tot) $tot.textContent=(totalDownlinePV>0?fmtNum(totalDownlinePV):'—')+' PV';
  const earnings=engine.calculateLegEarnings(legId);
  const $earn=row.querySelector('.leg-earnings');
  if($earn) { $earn.textContent=fmtUSD(earnings.monthly); $earn.title=`Monthly: ${fmtUSD(earnings.monthly)} | Yearly: ${fmtUSD(earnings.yearly)}`; }
}

function refreshAncestorDisplays(legId, engine, container) {
  refreshLegRowDisplays(legId, engine, container);
  let parent=document.querySelector(`.leg-row[data-leg-id="${legId}"]`)?.parentElement;
  while(parent){if(parent.classList?.contains('leg-row')){const pId=parseInt(parent.dataset.legId,10);if(!isNaN(pId))refreshLegRowDisplays(pId,engine,container);}parent=parent.parentElement;}
}

function renderLegRow(legId, container, depth, engine, onRecalc, onSave) {
  const node=engine.legMap.get(legId); if(!node) return;
  const row=document.createElement('div'); row.className='leg-row animate-fade-in-up'; row.dataset.legId=legId;
  const indentPx=depth*24;
  const vol=engine.calcLegVolume(legId);
  const bv=node.pv*engine.pvToBv;
  const hasChildren=node.children.length>0;
  const isCollapsed=engine.collapsedLegs.has(legId);
  const earnings=engine.calculateLegEarnings(legId);
  row.innerHTML=`
    <div class="leg-row-inner grid grid-cols-14 gap-1 sm:gap-1.5 items-center bg-surface/60 rounded-xl p-2 sm:p-2.5 border border-slate-700/30" style="margin-left:${indentPx}px">
      <div class="col-span-1 text-center flex items-center justify-center gap-0.5">
        ${hasChildren?`<button class="collapse-toggle w-5 h-5 rounded flex items-center justify-center text-muted hover:text-white hover:bg-slate-600/40 transition-all" title="${isCollapsed?'Expand':'Collapse'}"><svg class="w-3 h-3 transition-transform duration-200 ${isCollapsed?'':'rotate-90'}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg></button>`:''}
        <span class="leg-index inline-flex items-center justify-center w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-brand-600/20 text-brand-300 text-[9px] sm:text-xs font-bold"></span>
      </div>
      <div class="col-span-3 sm:col-span-2"><input type="text" class="leg-name w-full bg-surface border border-slate-600/50 rounded-lg py-1 sm:py-1.5 px-1.5 sm:px-2 text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/40 transition-all text-[10px] sm:text-xs" placeholder="Name" value="${escAttr(node.name)}"></div>
      <div class="col-span-2 sm:col-span-1"><div class="relative"><span class="absolute left-1.5 top-1/2 -translate-y-1/2 text-muted text-[8px]">PV</span><input type="number" class="leg-pv w-full bg-surface border border-slate-600/50 rounded-lg py-1 sm:py-1.5 pl-5 sm:pl-6 pr-1 text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/40 transition-all text-[10px] sm:text-xs font-semibold" min="0" step="1" placeholder="0" value="${node.pv||''}"></div></div>
      <div class="col-span-2 sm:col-span-1"><select class="leg-type-select w-full bg-surface border border-slate-600/50 rounded-lg py-1 sm:py-1.5 px-1 sm:px-1.5 text-[9px] sm:text-xs font-medium focus:outline-none focus:border-brand-500 transition-all"><option value="standard" ${node.type==='standard'?'selected':''} style="border-left:3px solid #94a3b8">Std</option><option value="core" ${node.type==='core'?'selected':''} style="border-left:3px solid #34d399">Core</option><option value="prosumer" ${node.type==='prosumer'?'selected':''} style="border-left:3px solid #fb923c">Pro</option><option value="strongRetail" ${node.type==='strongRetail'?'selected':''} style="border-left:3px solid #60a5fa">SR</option></select></div>
      <div class="col-span-1 hidden sm:block"><div class="leg-group-pv bg-surface/30 border border-slate-700/20 rounded-lg py-1 sm:py-1.5 px-1 sm:px-1.5 text-[9px] sm:text-xs font-medium text-muted truncate">${vol.groupPV>0?fmtNum(vol.groupPV):'—'}</div></div>
      <div class="col-span-1 hidden sm:block"><div class="leg-breakaway-pv bg-amber-900/20 border border-amber-700/20 rounded-lg py-1 sm:py-1.5 px-1 sm:px-1.5 text-[9px] sm:text-xs font-medium text-amber-300 truncate">${vol.breakawayPV>0?fmtNum(vol.breakawayPV):'—'}</div></div>
      <div class="col-span-2 sm:col-span-1"><div class="leg-total-pv bg-brand-900/30 border border-brand-700/30 rounded-lg py-1 sm:py-1.5 px-1 sm:px-1.5 text-[9px] sm:text-xs font-semibold text-brand-300 truncate">${vol.totalDownlinePV>0?fmtNum(vol.totalDownlinePV):'—'}</div></div>
      <div class="col-span-3 sm:col-span-2"><div class="leg-earnings bg-emerald-900/20 border border-emerald-700/20 rounded-lg py-1 sm:py-1.5 px-1 sm:px-1.5 text-[9px] sm:text-xs font-semibold text-emerald-400 truncate" title="Monthly: ${fmtUSD(earnings.monthly)} | Yearly: ${fmtUSD(earnings.yearly)}">${fmtUSD(earnings.monthly)}</div></div>
      <div class="col-span-1 sm:col-span-4 flex items-center justify-end gap-0.5 sm:gap-1">
        <button class="add-sub-leg w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-brand-500/10 text-brand-400 hover:bg-brand-500/25 hover:text-brand-300 transition-all flex items-center justify-center" title="Add sub-downline"><svg class="w-2.5 h-2.5 sm:w-3 sm:h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg></button>
        <button class="remove-leg w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500/25 hover:text-rose-300 transition-all flex items-center justify-center" title="Remove"><svg class="w-2.5 h-2.5 sm:w-3 sm:h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
      </div>
    </div>
    <div class="leg-children" ${isCollapsed?'style="display:none"':''}></div>`;
  const $pvInput=row.querySelector('.leg-pv'), $nameInput=row.querySelector('.leg-name'), $typeSelect=row.querySelector('.leg-type-select'), $removeBtn=row.querySelector('.remove-leg'), $addSubBtn=row.querySelector('.add-sub-leg'), $collapseBtn=row.querySelector('.collapse-toggle'), $cc=row.querySelector('.leg-children');
  $pvInput.addEventListener('input',()=>{const n=engine.legMap.get(legId);if(n)n.pv=parseNum($pvInput.value);refreshAncestorDisplays(legId,engine,container);onRecalc();onSave();});
  $nameInput.addEventListener('input',()=>{const n=engine.legMap.get(legId);if(n)n.name=$nameInput.value;updateLegIndices(container,engine);onSave();});
  $typeSelect.addEventListener('change',()=>{const n=engine.legMap.get(legId);if(n)n.type=$typeSelect.value;onSave();});
  $removeBtn.addEventListener('click',()=>{row.style.opacity='0';row.style.transform='translateX(20px)';setTimeout(()=>{const pr=row.parentElement?.closest('.leg-row');engine.removeLeg(legId);row.remove();engine.collapsedLegs.delete(legId);updateLegIndices(container,engine);if(pr){const pId=parseInt(pr.dataset.legId,10);if(!isNaN(pId))refreshAncestorDisplays(pId,engine,container);}onRecalc();onSave();},200);});
  $addSubBtn.addEventListener('click',()=>{
    const subId=engine.createLeg('Sub-leg',engine.defaultLegPv,0);
    const n=engine.legMap.get(legId); if(n) n.children.push(subId);
    renderLegRow(subId,$cc,depth+1,engine,onRecalc,onSave);
    updateLegIndices(container,engine);
    if(n && n.children.length===1) {
      const $indexCell=row.querySelector('.leg-row-inner > div:first-child');
      if($indexCell && !$indexCell.querySelector('.collapse-toggle')) {
        const btn=document.createElement('button');
        btn.className='collapse-toggle w-5 h-5 rounded flex items-center justify-center text-muted hover:text-white hover:bg-slate-600/40 transition-all';
        btn.title='Collapse';
        btn.innerHTML='<svg class="w-3 h-3 transition-transform duration-200 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>';
        btn.addEventListener('click',()=>{
          if(engine.collapsedLegs.has(legId)){engine.collapsedLegs.delete(legId);$cc.style.display='';btn.title='Collapse';const svg=btn.querySelector('svg');if(svg)svg.classList.add('rotate-90');}
          else{engine.collapsedLegs.add(legId);$cc.style.display='none';btn.title='Expand';const svg=btn.querySelector('svg');if(svg)svg.classList.remove('rotate-90');}
          onSave();
        });
        $indexCell.insertBefore(btn,$indexCell.firstChild);
      }
    }
    if(engine.collapsedLegs.has(legId)){engine.collapsedLegs.delete(legId);$cc.style.display='';const svg=$collapseBtn?.querySelector('svg');if(svg)svg.classList.add('rotate-90');}
    refreshAncestorDisplays(legId,engine,container);onRecalc();onSave();
  });
  if($collapseBtn){$collapseBtn.addEventListener('click',()=>{if(engine.collapsedLegs.has(legId)){engine.collapsedLegs.delete(legId);$cc.style.display='';$collapseBtn.title='Collapse';const svg=$collapseBtn.querySelector('svg');if(svg)svg.classList.add('rotate-90');}else{engine.collapsedLegs.add(legId);$cc.style.display='none';$collapseBtn.title='Expand';const svg=$collapseBtn.querySelector('svg');if(svg)svg.classList.remove('rotate-90');}onSave();});}
  container.appendChild(row);
}

function collapseAll(engine, container, $legCountEl) {
  engine.legMap.forEach((n,id)=>{if(n.children.length>0)engine.collapsedLegs.add(id);});
  rebuildAllLegs(container,engine,$legCountEl);
}

function expandAll(engine, container, $legCountEl) {
  engine.collapsedLegs.clear();
  rebuildAllLegs(container,engine,$legCountEl);
}

function renderLegTree(legId, container, depth, engine, onRecalc, onSave) {
  const node=engine.legMap.get(legId); if(!node) return;
  renderLegRow(legId, container, depth, engine, onRecalc, onSave);
  const row=container.querySelector(`.leg-row[data-leg-id="${legId}"]`); if(!row) return;
  const $cc=row.querySelector('.leg-children');
  node.children.forEach(cid=>renderLegTree(cid,$cc,depth+1,engine,onRecalc,onSave));
}

function updateLegIndices(container, engine) {
  const rows=container.querySelectorAll(':scope > .leg-row');
  rows.forEach((r,i)=>{const b=r.querySelector('.leg-index');if(b)b.textContent=i+1;});
}

function rebuildAllLegs(container, engine, $legCountEl) {
  container.innerHTML='';
  engine.topLevelLegs.forEach(id=>renderLegTree(id,container,0,engine,()=>{},()=>{}));
  updateLegIndices(container, engine);
  if($legCountEl) $legCountEl.textContent=`${engine.legMap.size} leg${engine.legMap.size!==1?'s':''}`;
}

// ============================================================
//  BONUS BREAKDOWN RENDERING
// ============================================================

function renderBonusBreakdown(bonuses, netBonus, totalEarnings, qual, rule412Met, iboLevel, groupPct, yearlyBonus, totalAllDownlineBV, $tbody) {
  if(!$tbody) return;
  const m=(v)=>fmtUSD(v);
  const y=(v)=>fmtUSD(v*12);
  const row=(label,calc,monthly,yearly,color)=>{
    return `<tr class="border-b border-slate-700/20"><td class="py-1.5 px-2 text-left ${color} text-xs">${label}</td><td class="py-1.5 px-2 text-left text-[10px] text-muted hidden sm:table-cell">${calc}</td><td class="py-1.5 px-2 text-right font-medium text-xs">${monthly}</td><td class="py-1.5 px-2 text-right text-muted text-xs">${yearly}</td></tr>`;
  };
  const rowBold=(label,calc,monthly,yearly,color)=>{
    return `<tr class="border-t-2 border-slate-600/60"><td class="py-2 px-2 text-left font-bold text-xs ${color}">${label}</td><td class="py-2 px-2 text-left text-[10px] text-muted hidden sm:table-cell">${calc}</td><td class="py-2 px-2 text-right font-extrabold text-xs">${monthly}</td><td class="py-2 px-2 text-right font-bold text-xs text-muted">${yearly}</td></tr>`;
  };
  let html='';
  const r412c=rule412Met?'text-emerald-400':'text-amber-400';
  html+=`<tr class="border-b border-slate-700/30"><td class="py-1 px-2 text-xs text-muted">Rule 4.12</td><td class="py-1 px-2 text-left text-[10px] text-muted hidden sm:table-cell">70% cust / 60% VCS</td><td class="py-1 px-2 text-right text-xs font-medium ${r412c}">${rule412Met?'✓ Compliant':'✗ Prorated'}</td><td class="py-1 px-2 text-xs text-muted">—</td></tr>`;
  html+=row('Retail Margin (10%)',`10% × ${m(bonuses.retailMargin/0.10)}`,`+${m(bonuses.retailMargin)}`,y(bonuses.retailMargin),'text-amber-300');
  if(bonuses.csi>0){const csiRate=((CSI_PCT-groupPct)*100).toFixed(0);html+=row(`Customer Sales Incentive (${csiRate}%)`,`${csiRate}% × VCS BV`,`+${m(bonuses.csi)}`,y(bonuses.csi),'text-amber-300');}
  html+=row('Personal Performance Bonus',`${(qual.bracket*100).toFixed(0)}% × Personal BV`,`+${m(bonuses.personalPerfBonus)}`,y(bonuses.personalPerfBonus),'text-emerald-400');
  if(bonuses.differentialBonus>0) html+=row('Differential Bonus',`Σ (Your% − Frontline%) × BV`,`+${m(bonuses.differentialBonus)}`,y(bonuses.differentialBonus),'text-emerald-400');
  if(bonuses.bronzeFoundation>0){const bfBase=bonuses.personalPerfBonus+bonuses.differentialBonus;html+=row('Bronze Foundation (30%)',`30% × ${m(bfBase)}`,`+${m(bonuses.bronzeFoundation)}`,y(bonuses.bronzeFoundation),'text-purple-400');}
  if(bonuses.bronzeBuilder>0){const bbBase=bonuses.personalPerfBonus+bonuses.differentialBonus;html+=row('Bronze Builder (40%)',`40% × ${m(bbBase)}`,`+${m(bonuses.bronzeBuilder)}`,y(bonuses.bronzeBuilder),'text-purple-400');}
  if(bonuses.perfElite>0) html+=row('Performance Elite (4%)',`on ${fmtNum(qual.rubyPV)} Ruby PV`,`+${m(bonuses.perfElite)}`,y(bonuses.perfElite),'text-pink-400');
  else if(bonuses.perfPlus>0) html+=row('Performance Plus (2%)',`on ${fmtNum(qual.rubyPV)} Ruby PV`,`+${m(bonuses.perfPlus)}`,y(bonuses.perfPlus),'text-pink-400');
  if(bonuses.rubyBonus>0) html+=row('Ruby Bonus (2%)',`on ${fmtNum(qual.rubyPV)} Ruby PV`,`+${m(bonuses.rubyBonus)}`,y(bonuses.rubyBonus),'text-pink-400');
  if(bonuses.leadershipBonus>0) html+=row('Leadership Bonus (up to 6%)','6% × qualifying BV',`+${m(bonuses.leadershipBonus)}`,y(bonuses.leadershipBonus),'text-cyan-400');
  if(bonuses.depthBonus>0) html+=row('Depth Bonus (up to 1%)','1% × 2nd level BV',`+${m(bonuses.depthBonus)}`,y(bonuses.depthBonus),'text-cyan-400');
  // Net IBO Bonus row hidden but math preserved
  const netClass=netBonus>0?'text-emerald-400':netBonus<0?'text-rose-400':'text-white';
  html+=`<tr style="display:none"><td></td><td></td><td class="py-2 px-2 text-right font-extrabold text-xs ${netClass}">${m(netBonus)}</td><td class="py-2 px-2 text-right font-bold text-xs text-muted">${y(netBonus)}</td></tr>`;
  html+=rowBold('Total (incl. Retail + CSI + Yearly/12)','',m(totalEarnings),y(totalEarnings),'text-brand-300');
  html+=`<tr class="border-t border-slate-700/40"><td colspan="4" class="py-1 px-2 text-[10px] text-muted uppercase tracking-wider">Yearly Estimates</td></tr>`;
  if(iboLevel==='full') html+=`<tr class="border-b border-slate-700/20"><td class="py-1.5 px-2 text-left text-xs text-slate-300">Strong Start Incentive</td><td class="py-1.5 px-2 text-left text-[10px] text-muted hidden sm:table-cell">$100+$300+$600</td><td class="py-1.5 px-2 text-right text-xs text-muted">—</td><td class="py-1.5 px-2 text-right text-xs text-amber-300 font-medium">+$1,000</td></tr>`;
  if(qual.isSilver) html+=`<tr class="border-b border-slate-700/20"><td class="py-1.5 px-2 text-left text-xs text-slate-300">Founders Platinum Bonus (est.)</td><td class="py-1.5 px-2 text-left text-[10px] text-muted hidden sm:table-cell">12 consecutive Silver months</td><td class="py-1.5 px-2 text-right text-xs text-muted">—</td><td class="py-1.5 px-2 text-right text-xs text-amber-300 font-medium">+$10,000</td></tr>`;
  if(qual.legs7500>=2) html+=`<tr class="border-b border-slate-700/20"><td class="py-1.5 px-2 text-left text-xs text-slate-300">Sapphire Bonus</td><td class="py-1.5 px-2 text-left text-[10px] text-muted hidden sm:table-cell">2x 7,500+ PV legs</td><td class="py-1.5 px-2 text-right text-xs text-muted">—</td><td class="py-1.5 px-2 text-right text-xs text-amber-300 font-medium">+$10,000</td></tr>`;
  // Profit sharing: 0.25% of total downline BV per month, ×12 for yearly
  const emeraldPSMonthly=(qual.legs7500>=3?(totalAllDownlineBV||0)*PROFIT_SHARING_PCT:0);
  const diamondPSMonthly=(qual.legs7500>=6?(totalAllDownlineBV||0)*PROFIT_SHARING_PCT:0);
  const emeraldPSYearly=emeraldPSMonthly*12;
  const diamondPSYearly=diamondPSMonthly*12;
  if(qual.legs7500>=3){
    html+=`<tr class="border-b border-slate-700/20"><td class="py-1.5 px-2 text-left text-xs text-slate-300">Emerald Bonus</td><td class="py-1.5 px-2 text-left text-[10px] text-muted hidden sm:table-cell">3x 7,500+ PV legs</td><td class="py-1.5 px-2 text-right text-xs text-muted">—</td><td class="py-1.5 px-2 text-right text-xs text-amber-300 font-medium">+$7,500</td></tr>`;
    html+=`<tr class="border-b border-slate-700/20"><td class="py-1.5 px-2 text-left text-xs text-slate-300">Emerald Profit Sharing (0.25%)</td><td class="py-1.5 px-2 text-left text-[10px] text-muted hidden sm:table-cell">0.25% × ${m(totalAllDownlineBV||0)} × 12</td><td class="py-1.5 px-2 text-right text-xs text-muted">—</td><td class="py-1.5 px-2 text-right text-xs text-amber-300 font-medium">+${m(emeraldPSYearly)}</td></tr>`;
  }
  if(qual.legs7500>=6){
    html+=`<tr class="border-b border-slate-700/20"><td class="py-1.5 px-2 text-left text-xs text-slate-300">Diamond Bonus</td><td class="py-1.5 px-2 text-left text-[10px] text-muted hidden sm:table-cell">6x 7,500+ PV legs</td><td class="py-1.5 px-2 text-right text-xs text-muted">—</td><td class="py-1.5 px-2 text-right text-xs text-amber-300 font-medium">+$15,000</td></tr>`;
    html+=`<tr class="border-b border-slate-700/20"><td class="py-1.5 px-2 text-left text-xs text-slate-300">Diamond Profit Sharing (0.25%)</td><td class="py-1.5 px-2 text-left text-[10px] text-muted hidden sm:table-cell">0.25% × ${m(totalAllDownlineBV||0)} × 12</td><td class="py-1.5 px-2 text-right text-xs text-muted">—</td><td class="py-1.5 px-2 text-right text-xs text-amber-300 font-medium">+${m(diamondPSYearly)}</td></tr>`;
  }
  $tbody.innerHTML=html;
}

function renderQualificationStatus(qual, personalPV, totalGroupPV, legDataList, rubyPV, rule412Met, customerPct, vcsPct, iboLevel, $tbody) {
  if(!$tbody) return;
  const row=(label,status,current,needed)=>{
    const sCls=status==='qualified'?'text-emerald-400':status==='partial'?'text-amber-400':'text-rose-400';
    const sTxt=status==='qualified'?'✓':status==='partial'?'◐':'✗';
    return `<tr class="border-b border-slate-700/20"><td class="py-1.5 px-2 text-left text-slate-300 text-xs">${label}</td><td class="py-1.5 px-2 text-center text-xs font-medium ${sCls}">${sTxt}</td><td class="py-1.5 px-2 text-right text-xs text-muted">${current}</td><td class="py-1.5 px-2 text-right text-xs text-muted">${needed}</td></tr>`;
  };
  let html='';
  html+=row('Rule 4.12 (70% customer / 60% VCS)',rule412Met?'qualified':'not-qualified',`${(customerPct*100).toFixed(0)}% / ${(vcsPct*100).toFixed(0)}% VCS`,'70% / 60%');
  html+=row('Strong Start Incentive',qual.ssiEligible?'qualified':'not-qualified',iboLevel==='full'?'Qualifies':'Not eligible','Qualify for SS, BF, and BB');
  html+=row('Bronze Foundation (30% multiplier)',qual.bfEligible?'qualified':(qual.bfLegs100>=3&&totalGroupPV>=600&&iboLevel==='full')?'partial':'not-qualified',`${fmtNum(totalGroupPV)} PV / ${qual.bfLegs100} leg(s)`,'600+ PV, 3x 100+ PV legs, SS/BF/BB tier');
  html+=row('Bronze Builder (40% multiplier)',qual.bbEligible?'qualified':(qual.bbLegs300>=3&&totalGroupPV>=2500&&(iboLevel==='full'||iboLevel==='bronzeOnly'))?'partial':'not-qualified',`${fmtNum(totalGroupPV)} PV / ${qual.bbLegs300} leg(s)`,'2,500+ PV, 3x 300+ PV legs, BB or higher tier');
  html+=row('Platinum',qual.isSilver?'qualified':'not-qualified',`${fmtNum(totalGroupPV)} PV`,'7,500+ PV or 7,500+ PV leg');
  html+=row('Performance Plus',qual.rubyPV>=10000?'qualified':'not-qualified',`${fmtNum(qual.rubyPV)} Ruby PV`,'10,000+ PV');
  html+=row('Performance Elite',qual.rubyPV>=12500?'qualified':'not-qualified',`${fmtNum(qual.rubyPV)} Ruby PV`,'12,500+ PV');
  html+=row('Ruby',qual.rubyPV>=15000?'qualified':qual.rubyPV>=10000?'partial':'not-qualified',`${fmtNum(qual.rubyPV)} Ruby PV`,'15,000+ PV');
  html+=row('Sapphire Bonus',qual.legs7500>=2?'qualified':qual.legs7500>=1?'partial':'not-qualified',`${qual.legs7500} leg(s) at 7,500+`,'2x 7,500+ PV legs');
  html+=row('Emerald',qual.isEmerald?'qualified':qual.qual25LegsCount>=1?'partial':'not-qualified',`${qual.qual25LegsCount} leg(s) at 25%`,'3x 7,500+ PV legs');
  html+=row('Diamond',qual.isDiamond?'qualified':qual.qual25LegsCount>=1?'partial':'not-qualified',`${qual.qual25LegsCount} leg(s) at 25%`,'6x 7,500+ PV legs');
  html+=row('Leadership Bonus',qual.lbEligible?'qualified':qual.qual25LegsCount>=1?'partial':'not-qualified',`${qual.qual25LegsCount} leg(s) at 25%`,'2x 7,500+ PV legs');
  html+=row('Depth Bonus',qual.dbEligible?'qualified':qual.qual25LegsCount>=3?'partial':'not-qualified',`${qual.qual25LegsCount} leg(s) at 25%`,'3x 7,500+ PV legs and depth');
  html+=row('FQ Count',qual.fqCount>0?'qualified':'not-qualified',`${qual.fqCount} frontline(s) at 25%`,'1+ per leg');
  $tbody.innerHTML=html;
}

function renderBracketGrid(totalPV, activeBracket, $grid) {
  if(!$grid) return;
  let html='';
  PERF_BONUS_BRACKETS.forEach(b=>{
    const active=b.minPV===activeBracket.minPV;
    const cls=active?'bg-brand-600/30 border-brand-500/60 ring-1 ring-brand-500/40':'bg-surface/60 border-slate-700/30';
    const pctCls=active?'text-brand-200':'text-muted';
    const pvCls=active?'text-white':'text-slate-400';
    html+=`<div class="${cls} rounded-lg px-2 py-2 text-center border transition-all"><div class="text-[10px] sm:text-xs font-bold ${pctCls}">${(b.pct*100).toFixed(0)}%</div><div class="text-[9px] sm:text-[10px] ${pvCls}">${b.label}</div></div>`;
  });
  $grid.innerHTML=html;
}

function updateBracketBar(totalPV, bracket, $bar) {
  let pct;
  if(bracket.minPV>=7500) pct=100;
  else{const next=PERF_BONUS_BRACKETS.find(b=>b.minPV>bracket.minPV);if(!next)pct=100;else{const range=next.minPV-bracket.minPV;const pos=totalPV-bracket.minPV;pct=Math.min(100,Math.max(0,(pos/range)*100));}}
  $bar.style.width=pct+'%';
}

// ============================================================
//  CORE RECALCULATE (for a given engine + DOM elements)
// ============================================================

function recalculateFor(engine, dom) {
  engine.personalPV=parseNum(dom.personalPV.value);
  engine.personalVcsPV=dom.personalVcsPV?parseNum(dom.personalVcsPV.value):engine.personalPV;
  engine.iboLevel=dom.iboLevel?dom.iboLevel.value:'full';
  const personalBV=engine.personalPV*engine.pvToBv;
  dom.personalBVDisplay.textContent=fmtUSD(personalBV);

  const r=engine.calcPersonal();
  dom.totalGroupPV.textContent=fmtNum(r.totalGroupPV);
  dom.totalGroupBV.textContent=fmtUSD(r.totalGroupBV);
  dom.qualifyingPct.textContent=(r.groupPct*100).toFixed(0)+'%';
  dom.groupEarningsDisplay.textContent=fmtUSD(r.totalEarnings);
  updateBracketBar(r.totalGroupPV,r.groupBracket,dom.bracketBar);
  renderBracketGrid(r.totalGroupPV,r.groupBracket,dom.bracketGrid);
  renderBonusBreakdown(r.bonuses,r.netBonus,r.totalEarnings,r.qual,r.rule412Met,r.iboLevel,r.groupPct,r.yearlyBonus,r.totalAllDownlineBV,dom.bonusBreakdownBody);
  renderQualificationStatus(r.qual,r.personalPV,r.totalGroupPV,r.legDataList,r.qual.rubyPV,r.rule412Met,r.customerPct,r.vcsPct,r.iboLevel,dom.qualificationBody);

  // Group payout: sum of all downline leg earnings (excludes personal)
  // Use the pre-computed earnings map from calcPersonal (already called above)
  let legEarningsSum = 0;
  if (engine._earningsMap) {
    engine._earningsMap.forEach((result) => { legEarningsSum += result.monthly; });
  } else {
    // Fallback: compute individually
    engine.legMap.forEach((n, id) => { legEarningsSum += engine.calculateLegEarnings(id).monthly; });
  }
  const groupMonthly = Math.round(legEarningsSum);
  const groupAnnual = groupMonthly * 12;
  if(dom.groupMonthlyPayout) dom.groupMonthlyPayout.textContent = '$' + groupMonthly.toLocaleString('en-US');
  if(dom.groupAnnualPayout) dom.groupAnnualPayout.textContent = '$' + groupAnnual.toLocaleString('en-US');
}

function recalculate() {
  recalculateFor(liveEngine, {
    personalPV:$personalPV, personalVcsPV:$personalVcsPV, personalBVDisplay:$personalBVDisplay,
    totalGroupPV:$totalGroupPV, totalGroupBV:$totalGroupBV, qualifyingPct:$qualifyingPct, bracketBar:$bracketBar,
    bracketGrid:$bracketGrid, bonusBreakdownBody:$bonusBreakdownBody, groupEarningsDisplay:$groupEarningsDisplay,
    qualificationBody:$qualificationBody, iboLevel:$iboLevelSelect,
    groupMonthlyPayout:$groupMonthlyPayout, groupAnnualPayout:$groupAnnualPayout,
  });
}

function projRecalculate() {
  if(!projEngine) return;
  // Sync projected engine inputs
  projEngine.personalPV=parseNum($projPersonalPV.value);
  projEngine.personalVcsPV=$projPersonalVcsPV?parseNum($projPersonalVcsPV.value):projEngine.personalPV;
  projEngine.iboLevel=$projIboLevelSelect?$projIboLevelSelect.value:'new';
  recalculateFor(projEngine, {
    personalPV:$projPersonalPV, personalVcsPV:$projPersonalVcsPV, personalBVDisplay:$projPersonalBVDisplay,
    totalGroupPV:$projTotalGroupPV, totalGroupBV:$projTotalGroupBV, qualifyingPct:$projQualifyingPct, bracketBar:$projBracketBar,
    bracketGrid:$projBracketGrid, bonusBreakdownBody:$projBonusBreakdownBody, groupEarningsDisplay:$projGroupEarningsDisplay,
    qualificationBody:$projQualificationBody, iboLevel:$projIboLevelSelect,
    groupMonthlyPayout:$projGroupMonthlyPayout, groupAnnualPayout:$projGroupAnnualPayout,
  });
}

// ============================================================
//  GROWTH SIMULATION
// ============================================================

function runGrowthSimulation() {
  const frontlineGrowth=parseNum($growthFrontline.value)||1;
  const growthSlow=parseNum($growthSlow.value)||0.5;
  const customerGrowthPv=parseNum($growthCustomerPv.value)||25;
  const maxCustomerPv=parseNum($growthMaxPv.value)||1000;
  const months=Math.max(1,Math.min(120,parseNum($growthMonths.value)||12));

  // Clone live engine state into projected engine
  projEngine=new CalcEngine();
  const liveData=liveEngine.serializeAll();
  projEngine.deserializeAll(liveData);
  projEngine.personalPV=liveEngine.personalPV;
  projEngine.personalVcsPV=liveEngine.personalVcsPV;
  projEngine.iboLevel=liveEngine.iboLevel;

  // Track per-leg state: {age, depth, spawnRate}
  // spawnRate = this leg's rate for sponsoring new children (parent-relative)
  // For frontline legs (depth 0), spawnRate = frontlineGrowth (you always recruit at full rate)
  // For child legs: spawnRate = parent.spawnRate × growthSlow (or frontlineGrowth if child is Core)
  const legState=new Map();
  function initState(){legState.clear();function walk(ids,d,parentRate){ids.forEach(id=>{const n=projEngine.legMap.get(id);if(!n)return;const legType=n.type||'standard';const spawnRate=legType==='core'?frontlineGrowth:parentRate;legState.set(id,{age:0,depth:d,spawnRate});walk(n.children,d+1,spawnRate*growthSlow);});}walk(projEngine.topLevelLegs,0,frontlineGrowth*growthSlow);}
  initState();

  let frontlineAccumulator=0;

  for(let m=1;m<=months;m++){
    const monthStr=String(m).padStart(2,'0');
    const existingLegIds=Array.from(legState.keys());

    // STEP 1: Customer PV growth — scaled by leg's spawnRate relative to frontlineGrowth
    if(projEngine.personalPV<maxCustomerPv){
      projEngine.personalPV=Math.min(maxCustomerPv,projEngine.personalPV+customerGrowthPv);
    }
    if(projEngine.personalVcsPV<maxCustomerPv){
      projEngine.personalVcsPV=Math.min(maxCustomerPv,projEngine.personalVcsPV+customerGrowthPv);
    }
    for(const legId of existingLegIds){
      const node=projEngine.legMap.get(legId);
      if(!node) continue;
      const state=legState.get(legId);
      // Customer growth multiplier = leg's spawnRate / frontlineGrowth
      // (e.g., if spawnRate=0.5 and frontlineGrowth=1, customer growth is half)
      const custMultiplier=state.spawnRate/frontlineGrowth;
      const gain=customerGrowthPv*custMultiplier;
      if(node.pv<maxCustomerPv){
        node.pv=Math.min(maxCustomerPv,node.pv+gain);
      }
    }

    // STEP 2: You recruit new frontline legs at full frontlineGrowth rate
    frontlineAccumulator+=frontlineGrowth;
    const newFrontlines=Math.floor(frontlineAccumulator);
    frontlineAccumulator-=newFrontlines;
    const newFrontlineIds=[];
    for(let i=0;i<newFrontlines;i++){
      const id=projEngine.createLeg('M'+monthStr,projEngine.defaultLegPv,0,'standard');
      projEngine.topLevelLegs.push(id);
      // Frontline legs: their children will spawn at frontlineGrowth×growthSlow
      legState.set(id,{age:0,depth:0,spawnRate:frontlineGrowth*growthSlow});
      newFrontlineIds.push(id);
    }

    // STEP 3: Pre-existing legs spawn downline based on their parent-relative spawnRate
    // Process by depth (shallowest first) so new legs don't spawn in same month
    const maxDepth=Math.max(0,...Array.from(legState.values()).map(s=>s.depth));
    for(let d=0;d<=maxDepth;d++){
      const legsAtDepth=Array.from(legState.entries()).filter(([id,s])=>s.depth===d && !newFrontlineIds.includes(id));
      for(const [legId,state] of legsAtDepth){
        const node=projEngine.legMap.get(legId);
        if(!node) continue;
        const legType=node.type||'standard';
        // Prosumer and Strong Retail never sponsor downline
        if(legType==='prosumer'||legType==='strongRetail'){state.age++;continue;}
        state.age++;
        // This leg's sponsoring rate = its spawnRate (already computed parent-relatively)
        const rate=state.spawnRate;
        const totalAccum=state.age*rate;
        const prevAccum=(state.age-1)*rate;
        const newLegs=Math.floor(totalAccum)-Math.floor(prevAccum);
        for(let i=0;i<newLegs;i++){
          const parentName=node.name||'Sub';
          const childId=projEngine.createLeg(parentName+'.'+monthStr,projEngine.defaultLegPv,0,'standard');
          node.children.push(childId);
          // Child's spawnRate = parent's spawnRate × growthSlow (child is always STD in sim)
          legState.set(childId,{age:0,depth:d+1,spawnRate:rate*growthSlow});
        }
      }
    }
  }

  // Show projected panel
  $projPanel.classList.remove('hidden');

  // Populate projected personal PV
  $projPersonalPV.value=Math.round(projEngine.personalPV);
  $projPersonalVcsPV.value=Math.round(projEngine.personalVcsPV);
  $projIboLevelSelect.value=projEngine.iboLevel;

  // Rebuild projected downline tree
  rebuildAllLegs($projDownlineContainer,projEngine,$projLegCount);

  // Initial calc
  projRecalculate();
}

function clearProjection() {
  $projPanel.classList.add('hidden');
  projEngine=null;
}

function exportProjectedStructure() {
  if(!projEngine){alert('No projection to export. Run growth simulation first.');return;}
  const payload=projEngine.serializeAll();
  payload.personalPV=parseNum($projPersonalPV.value);
  payload.personalVcsPV=parseNum($projPersonalVcsPV.value);
  payload.iboLevel=$projIboLevelSelect?$projIboLevelSelect.value:'full';
  const json=JSON.stringify(payload,null,2);
  const blob=new Blob([json],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=`amway-projected-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================
//  EXPORT / IMPORT
// ============================================================

function exportStructure() {
  const payload=buildSavePayload();
  const json=JSON.stringify(payload,null,2);
  const blob=new Blob([json],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=`amway-structure-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  if($saveIndicator) $saveIndicator.textContent='Exported';
  flashSaveIndicator();
}

function importStructure(file) {
  const reader=new FileReader();
  reader.onload=function(e){
    try{
      const data=JSON.parse(e.target.result);
      if(!data||typeof data!=='object'){alert('Invalid file format');return;}
      liveEngine.pvToBv=(typeof data.pvToBv==='number'&&data.pvToBv>0)?data.pvToBv:DEFAULT_PV_TO_BV;
      liveEngine.defaultLegPv=(typeof data.defaultLegPv==='number'&&data.defaultLegPv>=0)?data.defaultLegPv:DEFAULT_LEG_PV;
      if($personalPV&&typeof data.personalPV==='number') $personalPV.value=data.personalPV||'';
      if($personalVcsPV&&typeof data.personalVcsPV==='number') $personalVcsPV.value=data.personalVcsPV||'';
      if($iboLevelSelect&&data.iboLevel) $iboLevelSelect.value=data.iboLevel;
      liveEngine.legMap.clear();liveEngine.topLevelLegs=[];liveEngine.legIdCounter=0;
      if(Array.isArray(data.legs)) data.legs.forEach(t=>{const lid=liveEngine.deserializeLeg(t);if(lid!==null)liveEngine.topLevelLegs.push(lid);});
      liveEngine.collapsedLegs.clear();
      if(Array.isArray(data.collapsedLegs)) data.collapsedLegs.forEach(id=>liveEngine.collapsedLegs.add(id));
      renderSettings();rebuildAllLegs($downlineContainer,liveEngine,$legCount);recalculate();saveState();
      if($saveIndicator) $saveIndicator.textContent='Imported';
      flashSaveIndicator();
    }catch(err){alert('Error importing file: '+err.message);}
  };
  reader.readAsText(file);
}

// ============================================================
//  EVENTS & INIT
// ============================================================

function bindEvents() {
  $personalPV.addEventListener('input',()=>{recalculate();saveState();});
  if($personalVcsPV) $personalVcsPV.addEventListener('input',()=>{recalculate();saveState();});
  if($iboLevelSelect) $iboLevelSelect.addEventListener('change',()=>{recalculate();saveState();});
  $pvToBvInput.addEventListener('change',onSettingsChange);
  $pvToBvInput.addEventListener('blur',onSettingsChange);
  $defaultLegPvInput.addEventListener('change',onSettingsChange);
  $defaultLegPvInput.addEventListener('blur',onSettingsChange);
  $addLegBtn.addEventListener('click',()=>{
    const id=liveEngine.createLeg('New Leg',liveEngine.defaultLegPv,0);
    liveEngine.topLevelLegs.push(id);
    renderLegTree(id,$downlineContainer,0,liveEngine,recalculate,saveState);
    updateLegIndices($downlineContainer,liveEngine);
    $legCount.textContent=`${liveEngine.legMap.size} leg${liveEngine.legMap.size!==1?'s':''}`;
    recalculate();saveState();
  });
  $bulkAddBtn.addEventListener('click',()=>{
    const c=Math.max(1,Math.min(50,parseInt($bulkCountInput.value,10)||1));
    for(let i=0;i<c;i++){const id=liveEngine.createLeg('New Leg',liveEngine.defaultLegPv,0);liveEngine.topLevelLegs.push(id);}
    rebuildAllLegs($downlineContainer,liveEngine,$legCount);
    recalculate();saveState();
  });
  $resetBtn.addEventListener('click',()=>{if(confirm('Reset all data to defaults?'))resetToDefaults();});
  if($exportBtn) $exportBtn.addEventListener('click',exportStructure);
  if($importBtn) $importBtn.addEventListener('click',()=>{$importFileInput?.click();});
  if($importFileInput) $importFileInput.addEventListener('change',(e)=>{const file=e.target.files?.[0];if(file)importStructure(file);e.target.value='';});
  $personalPV.addEventListener('keydown',(e)=>{if(e.key==='Enter'){$addLegBtn.click();setTimeout(()=>{const r=$downlineContainer.querySelectorAll(':scope > .leg-row');if(r.length)r[r.length-1].querySelector('.leg-name').focus();},50);}});

  // Growth events
  if($growthRunBtn) $growthRunBtn.addEventListener('click',runGrowthSimulation);
  if($growthClearBtn) $growthClearBtn.addEventListener('click',clearProjection);
  if($growthExportBtn) $growthExportBtn.addEventListener('click',exportProjectedStructure);

  // Collapse / Expand all
  if($collapseAllBtn) $collapseAllBtn.addEventListener('click',()=>{collapseAll(liveEngine,$downlineContainer,$legCount);});
  if($expandAllBtn) $expandAllBtn.addEventListener('click',()=>{expandAll(liveEngine,$downlineContainer,$legCount);});
  if($projCollapseAllBtn) $projCollapseAllBtn.addEventListener('click',()=>{if(projEngine)collapseAll(projEngine,$projDownlineContainer,$projLegCount);});
  if($projExpandAllBtn) $projExpandAllBtn.addEventListener('click',()=>{if(projEngine)expandAll(projEngine,$projDownlineContainer,$projLegCount);});

  // Projected section events
  if($projPersonalPV) $projPersonalPV.addEventListener('input',()=>{projRecalculate();});
  if($projPersonalVcsPV) $projPersonalVcsPV.addEventListener('input',()=>{projRecalculate();});
  if($projIboLevelSelect) $projIboLevelSelect.addEventListener('change',()=>{projRecalculate();});
  if($projAddLegBtn) $projAddLegBtn.addEventListener('click',()=>{
    if(!projEngine) return;
    const id=projEngine.createLeg('New Leg',projEngine.defaultLegPv,0);
    projEngine.topLevelLegs.push(id);
    renderLegTree(id,$projDownlineContainer,0,projEngine,projRecalculate,()=>{});
    updateLegIndices($projDownlineContainer,projEngine);
    $projLegCount.textContent=`${projEngine.legMap.size} leg${projEngine.legMap.size!==1?'s':''}`;
    projRecalculate();
  });
}

(function init() {
  cacheDOM(); renderSettings();
  const restored=loadState();
  if(restored){rebuildAllLegs($downlineContainer,liveEngine,$legCount);}
  bindEvents(); recalculate();
})();
