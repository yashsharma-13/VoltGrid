
import { useState, useEffect, useReducer, useCallback, useRef } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, RadarChart, PolarGrid, PolarAngleAxis, Radar, PieChart, Pie, Cell, ReferenceLine } from "recharts";
import { Zap, Battery, Users, TrendingUp, TrendingDown, Package, Calendar, Settings, AlertTriangle, CheckCircle, XCircle, ChevronRight, ChevronDown, ChevronUp, BarChart2, Activity, BookOpen, Award, DollarSign, Target, Clock, Truck, MapPin, ArrowRight, RefreshCw, Play, Star, Info, AlertCircle } from "lucide-react";

// ============================================================
// CONSTANTS & DATA
// ============================================================

const BASE_DEMAND = { kanke: 45, hec: 65, mainRoad: 90, ratu: 55, doranda: 40 };
const SEASONAL_FACTORS = { 1: 0.90, 2: 1.20, 3: 0.85, 4: 1.30, 5: 1.00, 6: 1.15 };
const GROWTH_RATE = 0.08;

const CHARGER_TYPES = {
  SLOW: { name: "AC Slow (3.3 kW)", installCost: 45000, opCostPerDay: 150, serviceRate: 0.5, revenuePerSession: 80, lifeYears: 8, color: "#00A878" },
  FAST: { name: "DC Fast (50 kW)", installCost: 350000, opCostPerDay: 800, serviceRate: 2.0, revenuePerSession: 250, lifeYears: 7, color: "#0A4F8C" },
  ULTRA: { name: "Ultra-Fast (150 kW)", installCost: 1200000, opCostPerDay: 2500, serviceRate: 4.0, revenuePerSession: 500, lifeYears: 6, color: "#9B59B6" }
};

const ZONES = [
  { id: "kanke", name: "Kanke Road", type: "Residential", color: "#0A4F8C" },
  { id: "hec", name: "HEC Colony", type: "Industrial", color: "#00A878" },
  { id: "mainRoad", name: "Main Road", type: "Commercial", color: "#E8871E" },
  { id: "ratu", name: "Ratu Road", type: "Mixed", color: "#9B59B6" },
  { id: "doranda", name: "Doranda", type: "Govt/Mixed", color: "#1ABC9C" }
];

const QUARTER_INFO = {
  1: { label: "Q1 2025", period: "Jan–Mar 2025", season: "Winter", desc: "Moderate EV demand. A good time to establish your infrastructure." },
  2: { label: "Q2 2025", period: "Apr–Jun 2025", season: "Summer Peak", desc: "High demand season. AC vehicle usage surges. Expect queue pressure." },
  3: { label: "Q3 2025", period: "Jul–Sep 2025", season: "Monsoon", desc: "Variable demand. Maintenance challenges. Plan for power outages." },
  4: { label: "Q4 2025", period: "Oct–Dec 2025", season: "Festival Season", desc: "Major demand surge. Festival traffic boosts EV usage significantly." },
  5: { label: "Q5 2026", period: "Jan–Mar 2026", season: "Growth Phase", desc: "Steady growth. Time to optimize operations and reduce costs." },
  6: { label: "Q6 2026", period: "Apr–Jun 2026", season: "Final Quarter", desc: "Performance review quarter. Make your final push for profitability." }
};

const FIXED_COSTS_PER_QUARTER = 900000;
const LABOR = { wagePerDay: 800, OTMultiplier: 1.5, hiringCost: 15000, firingCost: 20000, chargersPerTech: 8, workdaysPerQ: 65 };
const INV = { energy: { unitCost: 8000, holdingRate: 0.02, orderCost: 25000, leadTimeDays: 21 }, parts: { unitCost: 2500, holdingRate: 0.015, orderCost: 8000, leadTimeDays: 14, usagePerChargerQ: 3 } };

// ============================================================
// OM ENGINE FUNCTIONS
// ============================================================

function seededRandom(seed) {
  let x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

function factorial(n) {
  if (n <= 1) return 1;
  let r = 1; for (let i = 2; i <= n; i++) r *= i; return r;
}

function calculateMMcQueue(lambda, mu, c) {
  if (c <= 0 || mu <= 0) return { stable: false, rho: 1, Lq: 999, Wq: 999, L: 999, W: 999, serviceLevel: 0, P0: 0, Pw: 1 };
  const rho = lambda / (c * mu);
  if (rho >= 0.99) return { stable: false, rho, Lq: 50, Wq: 120, L: 50, W: 120, serviceLevel: 0, P0: 0, Pw: 1 };
  let sum = 0;
  for (let n = 0; n < c; n++) sum += Math.pow(lambda / mu, n) / factorial(n);
  const lastTerm = Math.pow(lambda / mu, c) / (factorial(c) * (1 - rho));
  const P0 = 1 / (sum + lastTerm);
  const Lq = (P0 * Math.pow(lambda / mu, c) * rho) / (factorial(c) * Math.pow(1 - rho, 2));
  const Wq = Lq / lambda;
  const L = Lq + lambda / mu;
  const W = Wq + 1 / mu;
  const T = 0.25;
  const A = lambda / mu;
  const erlangC = (P0 * Math.pow(A, c)) / (factorial(c) * (1 - rho));
  const serviceLevel = Math.min(1, Math.max(0, 1 - erlangC * Math.exp(-(c * mu - lambda) * T)));
  const Pw = (P0 * Math.pow(lambda / mu, c)) / (factorial(c) * (1 - rho));
  return { stable: true, rho: +rho.toFixed(3), P0: +P0.toFixed(4), Lq: +Lq.toFixed(2), Wq: +(Wq * 60).toFixed(1), L: +L.toFixed(2), W: +(W * 60).toFixed(1), serviceLevel: +(serviceLevel * 100).toFixed(1), Pw: +(Pw * 100).toFixed(1) };
}

function calculateEOQ(D, S, H) { return Math.round(Math.sqrt((2 * D * S) / H)); }

function runSimulationRound(state, decisions, round) {
  const seed = round * 1000 + Object.values(decisions.installations || {}).flat().reduce((a, b) => a + (typeof b === "number" ? b : 0), 0);
  
  // Demand calculation
  const demandByZone = {};
  ZONES.forEach(z => {
    const base = BASE_DEMAND[z.id];
    const seasonal = SEASONAL_FACTORS[round];
    const growth = Math.pow(1 + GROWTH_RATE, round - 1);
    const priceAdj = decisions[`price_${z.id}`] ? -0.3 * ((decisions[`price_${z.id}`] / 250) - 1) : 0;
    const noise = (seededRandom(seed + z.id.length) - 0.5) * 0.2;
    demandByZone[z.id] = Math.max(5, Math.round(base * seasonal * growth * (1 + priceAdj) * (1 + noise)));
  });

  // Installations
  const installs = {};
  ZONES.forEach(z => {
    installs[z.id] = {};
    ["SLOW", "FAST", "ULTRA"].forEach(t => {
      installs[z.id][t] = (state.installations[z.id]?.[t] || 0) + (decisions.newInstall?.[z.id]?.[t] || 0);
    });
  });

  // Queue metrics per zone
  const queueByZone = {};
  ZONES.forEach(z => {
    const totalChargers = Object.values(installs[z.id]).reduce((a, b) => a + b, 0);
    const weightedMu = totalChargers > 0
      ? Object.entries(installs[z.id]).reduce((acc, [t, cnt]) => acc + (CHARGER_TYPES[t].serviceRate * cnt), 0) / totalChargers
      : 1;
    const lambda = demandByZone[z.id] / 18;
    queueByZone[z.id] = calculateMMcQueue(lambda, weightedMu, Math.max(1, totalChargers));
    queueByZone[z.id].chargers = totalChargers;
    queueByZone[z.id].lambda = +lambda.toFixed(3);
    queueByZone[z.id].mu = +weightedMu.toFixed(3);
    queueByZone[z.id].demand = demandByZone[z.id];
  });

  // Sessions
  const sessionsByZone = {};
  ZONES.forEach(z => {
    const totalChargers = Object.values(installs[z.id]).reduce((a, b) => a + b, 0);
    const effectiveCap = Object.entries(installs[z.id]).reduce((acc, [t, cnt]) => acc + CHARGER_TYPES[t].serviceRate * 18 * cnt * 0.85, 0);
    const svcLevel = queueByZone[z.id].serviceLevel / 100;
    sessionsByZone[z.id] = Math.min(demandByZone[z.id] * svcLevel, effectiveCap);
  });

  // Revenue
  let totalRevenue = 0;
  const revenueByZone = {};
  ZONES.forEach(z => {
    const avgPrice = Object.entries(installs[z.id]).reduce((acc, [t, cnt]) => {
      const total = Object.values(installs[z.id]).reduce((a, b) => a + b, 0);
      return acc + (total > 0 ? (decisions[`price${t}`] || CHARGER_TYPES[t].revenuePerSession) * cnt / total : 0);
    }, 0) || 150;
    revenueByZone[z.id] = sessionsByZone[z.id] * avgPrice * 90;
    totalRevenue += revenueByZone[z.id];
  });

  // Labor cost
  const totalChargers = ZONES.reduce((acc, z) => acc + Object.values(installs[z.id]).reduce((a, b) => a + b, 0), 0);
  const requiredWorkers = Math.ceil(totalChargers / LABOR.chargersPerTech);
  const strategy = decisions.apStrategy || "LEVEL";
  const currentWorkers = state.workforce.currentWorkers;
  let hire = 0, fire = 0, overtime = 0, undertime = 0;
  let targetWorkers = currentWorkers;
  if (strategy === "CHASE") {
    targetWorkers = Math.max(requiredWorkers, decisions.targetWorkforce || requiredWorkers);
    hire = Math.max(0, targetWorkers - currentWorkers);
    fire = Math.max(0, currentWorkers - targetWorkers);
  } else if (strategy === "LEVEL") {
    targetWorkers = currentWorkers;
    const regCap = currentWorkers * LABOR.workdaysPerQ;
    const needed = requiredWorkers * LABOR.workdaysPerQ;
    overtime = Math.max(0, needed - regCap) * 0.3;
    undertime = Math.max(0, regCap - needed) * 0.3;
  } else {
    targetWorkers = Math.ceil((currentWorkers + requiredWorkers) / 2);
    hire = Math.max(0, targetWorkers - currentWorkers);
    fire = Math.max(0, currentWorkers - targetWorkers);
    overtime = Math.max(0, (requiredWorkers - targetWorkers) * LABOR.workdaysPerQ * 0.5);
  }
  const laborCost = hire * LABOR.hiringCost + fire * LABOR.firingCost + targetWorkers * LABOR.wagePerDay * LABOR.workdaysPerQ + overtime * LABOR.wagePerDay * LABOR.OTMultiplier + undertime * LABOR.wagePerDay * 0.5;

  // Installation cost (one-time)
  let installCost = 0;
  ZONES.forEach(z => {
    ["SLOW", "FAST", "ULTRA"].forEach(t => {
      installCost += (decisions.newInstall?.[z.id]?.[t] || 0) * CHARGER_TYPES[t].installCost;
    });
  });

  // Charger operating cost
  let chargerOpCost = 0;
  ZONES.forEach(z => {
    ["SLOW", "FAST", "ULTRA"].forEach(t => {
      chargerOpCost += (installs[z.id][t] || 0) * CHARGER_TYPES[t].opCostPerDay * 90;
    });
  });

  // Maintenance cost
  const mainStrat = decisions.maintenanceStrategy || "PREVENTIVE";
  const maintFactor = mainStrat === "PREVENTIVE" ? 1.2 : mainStrat === "REACTIVE" ? 0.6 : 1.5;
  const maintenanceCost = totalChargers * 5000 * maintFactor;

  // Energy cost
  const energyRates = { GRID: 8.5, HYBRID: 7.2, SOLAR: 6.1 };
  const energyType = decisions.energyContract || "GRID";
  const totalSessions = Object.values(sessionsByZone).reduce((a, b) => a + b, 0) * 90;
  const energyCost = totalSessions * 0.8 * energyRates[energyType];

  // Inventory
  const annualEnergyDemand = totalSessions * 0.8 * 4;
  const eoqEnergy = calculateEOQ(annualEnergyDemand, INV.energy.orderCost, INV.energy.holdingRate * INV.energy.unitCost);
  const playerEnergyOrder = decisions.energyOrderKwh || eoqEnergy;
  const inventoryDeviation = Math.abs(playerEnergyOrder - eoqEnergy) / (eoqEnergy || 1);
  const holdingCostEnergy = (playerEnergyOrder / 2) * INV.energy.holdingRate * INV.energy.unitCost;
  const orderingCostEnergy = (annualEnergyDemand / (playerEnergyOrder || 1)) * INV.energy.orderCost / 4;

  // Stockout simulation
  const partsNeeded = totalChargers * INV.parts.usagePerChargerQ;
  const partsOrder = decisions.sparePartsOrder || Math.ceil(partsNeeded * 1.2);
  const currentParts = state.inventory.spareParts || 500;
  const stockoutEnergy = playerEnergyOrder < (totalSessions * 0.8 * 90 * 0.3) ? Math.round((totalSessions * 0.8 * 90 * 0.3 - playerEnergyOrder) * 0.1) : 0;
  const stockoutParts = (currentParts + partsOrder) < partsNeeded ? Math.round(partsNeeded - currentParts - partsOrder) : 0;
  const stockoutCost = (stockoutEnergy + stockoutParts) * 1500;

  // Total cost
  const totalCost = laborCost + chargerOpCost + installCost + maintenanceCost + energyCost + FIXED_COSTS_PER_QUARTER + holdingCostEnergy + orderingCostEnergy + stockoutCost;

  // Utilization
  const utilizationByZone = {};
  ZONES.forEach(z => {
    const designCap = Object.entries(installs[z.id]).reduce((acc, [t, cnt]) => acc + CHARGER_TYPES[t].serviceRate * 18 * cnt, 0);
    utilizationByZone[z.id] = designCap > 0 ? Math.min(100, +(sessionsByZone[z.id] * 90 / (designCap * 90) * 100).toFixed(1)) : 0;
  });
  const avgUtilization = ZONES.reduce((acc, z) => acc + utilizationByZone[z.id], 0) / 5;
  const avgServiceLevel = ZONES.reduce((acc, z) => acc + queueByZone[z.id].serviceLevel, 0) / 5;
  const avgWaitTime = ZONES.reduce((acc, z) => acc + queueByZone[z.id].Wq, 0) / 5;

  const netProfit = totalRevenue - totalCost;

  // Score
  const utilScore = avgUtilization >= 70 && avgUtilization <= 85 ? 12.5 : avgUtilization >= 60 ? 10 : avgUtilization >= 50 ? 7 : 4;
  const svcScore = avgServiceLevel >= 90 ? 12.5 : avgServiceLevel >= 85 ? 11 : avgServiceLevel >= 75 ? 8 : 5;
  const finScore = netProfit > 500000 ? 25 : netProfit > 200000 ? 20 : netProfit > 0 ? 15 : netProfit > -200000 ? 8 : 3;
  const stockScore = (stockoutEnergy + stockoutParts) === 0 ? 12.5 : Math.max(0, 12.5 - (stockoutEnergy + stockoutParts) * 2);
  const eoqScore = inventoryDeviation < 0.1 ? 12.5 : inventoryDeviation < 0.3 ? 10 : inventoryDeviation < 0.5 ? 7 : 4;
  const roundScore = { operational: utilScore + svcScore, financial: finScore, inventory: stockScore + eoqScore, total: utilScore + svcScore + finScore + stockScore + eoqScore };

  // Theory feedback
  const feedback = [];
  if (avgUtilization > 88) feedback.push({ concept: "Capacity Planning", icon: "zap", color: "danger", title: "System Overloaded", explanation: `Charger utilization hit ${avgUtilization.toFixed(1)}%. M/M/c theory predicts exponential queue growth as ρ→1. Your Wq jumped to ${avgWaitTime.toFixed(1)} min.`, formula: "Lq = P₀(λ/μ)^c × ρ / [c!(1-ρ)²] — as ρ→1, Lq→∞", suggestion: "Add 2–3 more chargers to target 70–85% utilization zone." });
  if (avgUtilization < 45) feedback.push({ concept: "Capacity Planning", icon: "bar-chart-2", color: "info", title: "Underutilized Capacity", explanation: `Utilization of ${avgUtilization.toFixed(1)}% means fixed costs are absorbing revenue. Break-even utilization: ~55%.`, formula: "Break-even Util = Fixed Cost / (Revenue/session – Variable Cost/session)", suggestion: "Reduce charger count or boost demand through marketing and pricing." });
  if (strategy === "CHASE" && hire + fire > 3) feedback.push({ concept: "Aggregate Planning", icon: "calendar", color: "warning", title: "Chase Strategy Costs Rising", explanation: `You hired ${hire} and fired ${fire} workers, costing ₹${((hire * LABOR.hiringCost + fire * LABOR.firingCost) / 100000).toFixed(1)}L in HR costs alone.`, formula: "AP Chase Cost = Hires×₹15,000 + Fires×₹20,000 + Regular Labor", suggestion: "Consider Mixed strategy to reduce expensive hire/fire cycles." });
  if (strategy === "LEVEL" && undertime > 500) feedback.push({ concept: "Aggregate Planning", icon: "activity", color: "info", title: "Level Strategy: Idle Labor", explanation: `${Math.round(undertime)} undertime hours at ₹${LABOR.wagePerDay}/hr means ₹${Math.round(undertime * LABOR.wagePerDay * 0.5 / 1000)}K in idle labor cost.`, formula: "Undertime Cost = Idle Hours × Wage Rate × 0.5", suggestion: "Use idle time for preventive maintenance and technician training." });
  if (stockoutEnergy + stockoutParts > 0) feedback.push({ concept: "Inventory Management", icon: "package", color: "danger", title: "Stockout Occurred!", explanation: `${stockoutEnergy + stockoutParts} units short. ROP was insufficient. Stockout cost: ₹${stockoutCost.toLocaleString("en-IN")}.`, formula: "ROP = d̄×L + z×σd×√L — Your safety stock was below the required level", suggestion: `Order at least EOQ=${eoqEnergy} kWh and maintain safety stock of ${Math.round(eoqEnergy * 0.15)} units.` });
  if (inventoryDeviation > 0.3) feedback.push({ concept: "Inventory Management", icon: "trending-up", color: "warning", title: `Order Quantity ${playerEnergyOrder > eoqEnergy ? "Above" : "Below"} EOQ`, explanation: `You ordered ${playerEnergyOrder} vs EOQ recommendation of ${eoqEnergy}. Extra cost: ₹${Math.round(Math.abs(holdingCostEnergy + orderingCostEnergy - (eoqEnergy / 2 * INV.energy.holdingRate * INV.energy.unitCost + (annualEnergyDemand / eoqEnergy) * INV.energy.orderCost / 4))).toLocaleString("en-IN")}.`, formula: `EOQ = √(2DS/H) = √(2×${Math.round(annualEnergyDemand)}×${INV.energy.orderCost}/${Math.round(INV.energy.holdingRate * INV.energy.unitCost)}) = ${eoqEnergy}`, suggestion: "Align order quantity with EOQ to minimize total inventory cost." });
  if (avgWaitTime > 20) feedback.push({ concept: "Queuing Theory", icon: "users", color: "danger", title: "Excessive Queue Wait Times", explanation: `Average Wq=${avgWaitTime.toFixed(1)} min across zones. M/M/c analysis shows high ρ is causing queue buildup beyond the 15-min service target.`, formula: "Wq = Lq/λ = [P₀(λ/μ)^c×ρ] / [c!×λ×(1-ρ)²]", suggestion: "Add servers where ρ>0.85. Each additional charger at high-utilization zones will dramatically reduce Wq." });

  return {
    round, installs, demandByZone, sessionsByZone, revenueByZone, totalRevenue, laborCost, installCost,
    chargerOpCost, maintenanceCost, energyCost, holdingCostEnergy, orderingCostEnergy, stockoutCost,
    totalCost, netProfit, utilizationByZone, avgUtilization, queueByZone, avgServiceLevel, avgWaitTime,
    hire, fire, targetWorkers, overtime, undertime, eoqEnergy, playerEnergyOrder, inventoryDeviation,
    stockoutEnergy, stockoutParts, partsNeeded, feedback, roundScore
  };
}

// ============================================================
// INITIAL STATE
// ============================================================

const initialState = {
  phase: "LANDING",
  round: 0,
  playerName: "",
  institution: "",
  difficulty: "STANDARD",
  capital: 5000000,
  cumulativeRevenue: 0,
  cumulativeCost: 0,
  cumulativeProfit: 0,
  installations: { kanke: { SLOW: 0, FAST: 0, ULTRA: 0 }, hec: { SLOW: 0, FAST: 0, ULTRA: 0 }, mainRoad: { SLOW: 0, FAST: 0, ULTRA: 0 }, ratu: { SLOW: 0, FAST: 0, ULTRA: 0 }, doranda: { SLOW: 0, FAST: 0, ULTRA: 0 } },
  workforce: { currentWorkers: 10, totalHired: 0, totalFired: 0 },
  inventory: { energyStorageKwh: 100, spareParts: 500 },
  history: [],
  currentDecisions: {},
  lastResult: null,
  scores: [],
  totalScore: 0,
  briefingStep: 0,
  activeDecisionTab: "capacity",
  activeDashTab: "summary"
};

function reducer(state, action) {
  switch (action.type) {
    case "SET_PHASE": return { ...state, phase: action.payload };
    case "SET_PLAYER": return { ...state, playerName: action.playerName, institution: action.institution, difficulty: action.difficulty, phase: "BRIEFING" };
    case "SET_BRIEFING_STEP": return { ...state, briefingStep: action.payload };
    case "START_ROUND": return { ...state, phase: "DECISION", round: state.round + 1, currentDecisions: getDefaultDecisions(state) };
    case "UPDATE_DECISION": return { ...state, currentDecisions: { ...state.currentDecisions, ...action.payload } };
    case "UPDATE_INSTALL": {
      const ni = { ...(state.currentDecisions.newInstall || {}) };
      ni[action.zone] = { ...(ni[action.zone] || { SLOW: 0, FAST: 0, ULTRA: 0 }), [action.chargerType]: Math.max(0, action.value) };
      return { ...state, currentDecisions: { ...state.currentDecisions, newInstall: ni } };
    }
    case "SUBMIT_ROUND": {
      const result = runSimulationRound(state, state.currentDecisions, state.round);
      const newHistory = [...state.history, { round: state.round, decisions: state.currentDecisions, result }];
      const newScores = [...state.scores, result.roundScore];
      const totalScore = Math.min(100, Math.round(newScores.reduce((acc, s, i) => { const w = i < 2 ? 0.1 : i < 4 ? 0.15 : 0.25; return acc + s.total * w; }, 0)));
      return {
        ...state, phase: "DASHBOARD", lastResult: result, history: newHistory, scores: newScores, totalScore,
        installations: result.installs,
        capital: state.capital + result.netProfit,
        cumulativeRevenue: state.cumulativeRevenue + result.totalRevenue,
        cumulativeCost: state.cumulativeCost + result.totalCost,
        cumulativeProfit: state.cumulativeProfit + result.netProfit,
        workforce: { ...state.workforce, currentWorkers: result.targetWorkers, totalHired: state.workforce.totalHired + result.hire, totalFired: state.workforce.totalFired + result.fire },
        inventory: { energyStorageKwh: Math.max(0, (state.inventory.energyStorageKwh || 0) + (state.currentDecisions.energyOrderKwh || 0) - (result.totalRevenue / 300)), spareParts: Math.max(0, (state.inventory.spareParts || 500) + (state.currentDecisions.sparePartsOrder || 0) - result.partsNeeded) }
      };
    }
    case "SET_DASH_TAB": return { ...state, activeDashTab: action.payload };
    case "SET_DECISION_TAB": return { ...state, activeDecisionTab: action.payload };
    case "NEXT_QUARTER": return { ...state, phase: state.round >= 6 ? "FINAL" : state.round === 2 || state.round === 4 ? "REVIEW" : "DECISION", round: state.round < 6 ? state.round + 1 : state.round, currentDecisions: state.round < 6 ? getDefaultDecisions(state) : state.currentDecisions };
    case "FROM_REVIEW": return { ...state, phase: "DECISION" };
    default: return state;
  }
}

function getDefaultDecisions(state) {
  const totalC = ZONES.reduce((acc, z) => acc + Object.values(state.installations[z.id] || {}).reduce((a, b) => a + b, 0), 0);
  const eoqE = calculateEOQ(totalC * 200, INV.energy.orderCost, INV.energy.holdingRate * INV.energy.unitCost);
  return {
    newInstall: { kanke: { SLOW: 0, FAST: 0, ULTRA: 0 }, hec: { SLOW: 0, FAST: 0, ULTRA: 0 }, mainRoad: { SLOW: 0, FAST: 0, ULTRA: 0 }, ratu: { SLOW: 0, FAST: 0, ULTRA: 0 }, doranda: { SLOW: 0, FAST: 0, ULTRA: 0 } },
    apStrategy: "LEVEL", targetWorkforce: state.workforce.currentWorkers, authorizedOvertimePct: 10,
    energyOrderKwh: eoqE, sparePartsOrder: Math.ceil(totalC * 4),
    maxQueueLength: 20, priorityRule: "FCFS",
    priceSLOW: 80, priceFAST: 250, priceULTRA: 500,
    energyContract: "GRID", maintenanceStrategy: "PREVENTIVE"
  };
}

// ============================================================
// STYLES
// ============================================================

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=IBM+Plex+Mono:wght@400;500;700&family=Source+Serif+4:wght@300;400;600&display=swap');
  
  :root {
    --bg: #FFFFFF; --bg2: #F8F9FA; --bg3: #EEF2F7;
    --navy: #0A4F8C; --green: #00A878; --amber: #E8871E; --red: #D93025; --blue: #1565C0; --purple: #9B59B6;
    --text1: #1A1A2E; --text2: #4A5568; --text3: #718096;
    --border1: #E2E8F0; --border2: #CBD5E0;
    --shadow: 0 2px 12px rgba(10,79,140,0.08);
    --shadow-lg: 0 8px 32px rgba(10,79,140,0.12);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Source Serif 4', serif; background: var(--bg); color: var(--text1); }
  
  .app { min-height: 100vh; background: #fff; }
  
  /* LANDING */
  .hero { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; background: linear-gradient(135deg, #f8f9ff 0%, #eef2f7 50%, #f0f8f5 100%); position: relative; overflow: hidden; padding: 40px 20px; }
  .hero::before { content: ''; position: absolute; inset: 0; background: repeating-linear-gradient(0deg, transparent, transparent 40px, rgba(10,79,140,0.02) 40px, rgba(10,79,140,0.02) 41px), repeating-linear-gradient(90deg, transparent, transparent 40px, rgba(10,79,140,0.02) 40px, rgba(10,79,140,0.02) 41px); }
  .hero-content { position: relative; text-align: center; max-width: 700px; }
  .hero-supertitle { font-family: 'IBM Plex Mono', monospace; font-size: 0.7rem; letter-spacing: 0.15em; color: var(--text3); text-transform: uppercase; margin-bottom: 16px; }
  .hero-title { font-family: 'DM Serif Display', serif; font-size: clamp(3rem, 8vw, 5rem); color: var(--navy); line-height: 1; margin-bottom: 12px; }
  .hero-title span { color: var(--green); }
  .hero-sub { font-family: 'Source Serif 4', serif; font-size: 1.25rem; color: var(--text2); margin-bottom: 24px; }
  .hero-desc { font-size: 1rem; color: var(--text3); max-width: 500px; margin: 0 auto 40px; line-height: 1.7; }
  
  .bolt-grid { display: flex; gap: 12px; justify-content: center; margin-bottom: 32px; }
  .bolt-icon { width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; animation: pulse 2s infinite; }
  .bolt-icon:nth-child(2) { animation-delay: 0.4s; }
  .bolt-icon:nth-child(3) { animation-delay: 0.8s; }
  @keyframes pulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.1);opacity:0.8} }
  
  .btn-primary { background: var(--navy); color: white; border: none; padding: 16px 40px; font-family: 'IBM Plex Mono', monospace; font-size: 0.9rem; letter-spacing: 0.05em; border-radius: 8px; cursor: pointer; transition: all 0.2s; font-weight: 700; display: inline-flex; align-items: center; gap: 8px; }
  .btn-primary:hover { background: #0d5fa8; transform: translateY(-2px); box-shadow: 0 8px 24px rgba(10,79,140,0.25); }
  .btn-secondary { background: transparent; color: var(--navy); border: 2px solid var(--navy); padding: 12px 28px; font-family: 'IBM Plex Mono', monospace; font-size: 0.85rem; border-radius: 8px; cursor: pointer; transition: all 0.2s; margin-left: 12px; }
  .btn-secondary:hover { background: var(--navy); color: white; }
  .btn-green { background: var(--green); color: white; border: none; padding: 14px 32px; font-family: 'IBM Plex Mono', monospace; font-size: 0.9rem; border-radius: 8px; cursor: pointer; transition: all 0.2s; font-weight: 700; display: inline-flex; align-items: center; gap: 8px; }
  .btn-green:hover { background: #009068; transform: translateY(-1px); }
  .btn-outline { background: transparent; border: 1.5px solid var(--border2); color: var(--text2); padding: 10px 20px; font-family: 'IBM Plex Mono', monospace; font-size: 0.8rem; border-radius: 6px; cursor: pointer; transition: all 0.2s; }
  .btn-outline:hover { border-color: var(--navy); color: var(--navy); }
  
  /* SECTIONS */
  .section { padding: 80px 40px; max-width: 1100px; margin: 0 auto; }
  .section-label { font-family: 'IBM Plex Mono', monospace; font-size: 0.7rem; letter-spacing: 0.15em; color: var(--green); text-transform: uppercase; margin-bottom: 8px; }
  .section-title { font-family: 'DM Serif Display', serif; font-size: 2rem; color: var(--navy); margin-bottom: 16px; }
  .section-divider { border: none; border-top: 2px solid var(--border1); margin: 60px 0; }
  
  /* ZONE CARDS */
  .zone-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-top: 24px; }
  .zone-card { background: white; border: 1.5px solid var(--border1); border-radius: 12px; padding: 20px; transition: all 0.2s; }
  .zone-card:hover { border-color: var(--navy); box-shadow: var(--shadow); transform: translateY(-2px); }
  .zone-name { font-family: 'DM Serif Display', serif; font-size: 1.1rem; color: var(--text1); margin-bottom: 4px; }
  .zone-type { font-family: 'IBM Plex Mono', monospace; font-size: 0.7rem; color: var(--text3); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 12px; }
  .zone-demand { display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: var(--text2); }
  
  /* CONCEPT CARDS */
  .concept-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-top: 24px; }
  @media(max-width:700px){ .concept-grid { grid-template-columns: 1fr; } }
  .concept-card { background: white; border: 1.5px solid var(--border1); border-radius: 12px; padding: 24px; border-left: 5px solid var(--navy); transition: all 0.2s; }
  .concept-card:hover { box-shadow: var(--shadow-lg); transform: translateY(-2px); }
  .concept-title { font-family: 'DM Serif Display', serif; font-size: 1.2rem; color: var(--text1); margin-bottom: 8px; }
  .concept-desc { font-size: 0.9rem; color: var(--text2); line-height: 1.6; margin-bottom: 12px; }
  .concept-tags { display: flex; flex-wrap: wrap; gap: 6px; }
  .concept-tag { background: var(--bg2); color: var(--text3); padding: 3px 10px; border-radius: 20px; font-family: 'IBM Plex Mono', monospace; font-size: 0.65rem; letter-spacing: 0.05em; }
  
  /* METRICS TABLE */
  .metrics-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
  .metrics-table th { background: var(--navy); color: white; padding: 12px 16px; text-align: left; font-family: 'IBM Plex Mono', monospace; font-size: 0.75rem; letter-spacing: 0.05em; }
  .metrics-table td { padding: 12px 16px; border-bottom: 1px solid var(--border1); font-size: 0.9rem; }
  .metrics-table tr:hover td { background: var(--bg2); }
  
  /* FORMULA TABS */
  .formula-tabs { display: flex; gap: 4px; margin-bottom: 0; border-bottom: 2px solid var(--border1); }
  .formula-tab { font-family: 'IBM Plex Mono', monospace; font-size: 0.75rem; padding: 10px 16px; border: none; background: none; cursor: pointer; color: var(--text3); letter-spacing: 0.05em; border-bottom: 2px solid transparent; margin-bottom: -2px; transition: all 0.2s; }
  .formula-tab.active { color: var(--navy); border-bottom-color: var(--navy); font-weight: 700; }
  .formula-box { background: var(--bg2); border-radius: 0 0 12px 12px; padding: 24px; min-height: 200px; }
  .formula-item { background: white; border: 1px solid var(--border1); border-left: 4px solid var(--navy); border-radius: 0 8px 8px 0; padding: 12px 16px; margin-bottom: 12px; font-family: 'IBM Plex Mono', monospace; font-size: 0.8rem; color: var(--text1); }
  
  /* PLAYER SETUP */
  .setup-card { background: white; border: 2px solid var(--border1); border-radius: 16px; padding: 36px; max-width: 560px; margin: 40px auto 0; box-shadow: var(--shadow-lg); }
  .setup-title { font-family: 'DM Serif Display', serif; font-size: 1.5rem; color: var(--navy); margin-bottom: 24px; }
  .form-group { margin-bottom: 20px; }
  .form-label { display: block; font-family: 'IBM Plex Mono', monospace; font-size: 0.75rem; letter-spacing: 0.05em; color: var(--text3); text-transform: uppercase; margin-bottom: 6px; }
  .form-input { width: 100%; padding: 12px 16px; border: 1.5px solid var(--border2); border-radius: 8px; font-family: 'Source Serif 4', serif; font-size: 0.95rem; color: var(--text1); background: white; transition: border-color 0.2s; outline: none; }
  .form-input:focus { border-color: var(--navy); }
  .radio-group { display: flex; gap: 12px; flex-wrap: wrap; }
  .radio-option { flex: 1; min-width: 120px; border: 1.5px solid var(--border2); border-radius: 8px; padding: 12px; cursor: pointer; transition: all 0.2s; text-align: center; }
  .radio-option.selected { border-color: var(--navy); background: #EBF5FF; }
  .radio-option-label { font-family: 'IBM Plex Mono', monospace; font-size: 0.8rem; font-weight: 700; color: var(--text1); display: block; margin-bottom: 2px; }
  .radio-option-sub { font-size: 0.75rem; color: var(--text3); }
  
  /* BRIEFING */
  .briefing-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #f0f4ff 0%, #f0faf7 100%); padding: 40px 20px; }
  .briefing-card { background: white; border-radius: 20px; padding: 48px; max-width: 720px; width: 100%; box-shadow: var(--shadow-lg); border: 1px solid var(--border1); }
  .briefing-step-title { font-family: 'DM Serif Display', serif; font-size: 1.8rem; color: var(--navy); margin-bottom: 8px; }
  .briefing-step-sub { font-family: 'IBM Plex Mono', monospace; font-size: 0.75rem; color: var(--text3); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 28px; }
  .briefing-letter { background: var(--bg2); border-left: 4px solid var(--navy); border-radius: 0 12px 12px 0; padding: 24px; font-size: 0.95rem; color: var(--text2); line-height: 1.8; margin-bottom: 24px; }
  .briefing-table { width: 100%; border-collapse: collapse; }
  .briefing-table td { padding: 12px 16px; border-bottom: 1px solid var(--border1); font-size: 0.9rem; }
  .briefing-table td:first-child { color: var(--text3); font-family: 'IBM Plex Mono', monospace; font-size: 0.8rem; }
  .briefing-table td:last-child { font-weight: 600; color: var(--text1); text-align: right; }
  .briefing-progress { display: flex; gap: 8px; margin-bottom: 32px; }
  .briefing-dot { height: 6px; flex: 1; border-radius: 3px; background: var(--border2); transition: background 0.3s; }
  .briefing-dot.active { background: var(--navy); }
  .briefing-dot.done { background: var(--green); }
  
  /* SIMULATION SHELL */
  .sim-shell { display: flex; flex-direction: column; min-height: 100vh; background: #fff; }
  .topbar { background: var(--navy); color: white; padding: 0 24px; height: 64px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 100; }
  .topbar-brand { font-family: 'DM Serif Display', serif; font-size: 1.4rem; display: flex; align-items: center; gap: 10px; }
  .topbar-info { display: flex; align-items: center; gap: 24px; }
  .topbar-item { text-align: right; }
  .topbar-item-label { font-family: 'IBM Plex Mono', monospace; font-size: 0.65rem; letter-spacing: 0.1em; opacity: 0.7; text-transform: uppercase; }
  .topbar-item-value { font-family: 'IBM Plex Mono', monospace; font-size: 0.95rem; font-weight: 700; }
  .quarter-badge { background: rgba(255,255,255,0.15); border-radius: 8px; padding: 6px 14px; font-family: 'IBM Plex Mono', monospace; font-size: 0.8rem; font-weight: 700; }
  
  .sim-body { display: flex; flex: 1; }
  .sidebar { width: 220px; background: var(--bg2); border-right: 1px solid var(--border1); padding: 20px 12px; flex-shrink: 0; position: sticky; top: 64px; height: calc(100vh - 64px); overflow-y: auto; }
  .sidebar-section { margin-bottom: 24px; }
  .sidebar-label { font-family: 'IBM Plex Mono', monospace; font-size: 0.65rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text3); padding: 0 8px; margin-bottom: 6px; }
  .sidebar-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; cursor: pointer; transition: all 0.15s; font-size: 0.85rem; color: var(--text2); font-family: 'Source Serif 4', serif; }
  .sidebar-item:hover { background: white; color: var(--navy); }
  .sidebar-item.active { background: var(--navy); color: white; }
  .sidebar-item svg { flex-shrink: 0; }
  .sidebar-score { background: white; border: 1.5px solid var(--border1); border-radius: 10px; padding: 14px; text-align: center; margin-top: 16px; }
  .sidebar-score-label { font-family: 'IBM Plex Mono', monospace; font-size: 0.65rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text3); margin-bottom: 4px; }
  .sidebar-score-value { font-family: 'IBM Plex Mono', monospace; font-size: 1.8rem; font-weight: 700; color: var(--navy); }
  
  .main-content { flex: 1; padding: 24px; overflow-y: auto; min-width: 0; }
  
  /* KPI CARDS */
  .kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
  @media(max-width:900px){ .kpi-row { grid-template-columns: repeat(2,1fr); } }
  .kpi-card { background: white; border: 1px solid var(--border1); border-radius: 10px; padding: 20px 24px; border-left: 4px solid var(--navy); box-shadow: var(--shadow); transition: all 0.2s; }
  .kpi-card:hover { box-shadow: var(--shadow-lg); transform: translateY(-1px); }
  .kpi-label { font-family: 'IBM Plex Mono', monospace; font-size: 0.65rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text3); margin-bottom: 6px; }
  .kpi-value { font-family: 'IBM Plex Mono', monospace; font-size: 1.6rem; font-weight: 700; color: var(--text1); margin-bottom: 4px; }
  .kpi-trend { font-family: 'IBM Plex Mono', monospace; font-size: 0.75rem; display: flex; align-items: center; gap: 4px; }
  .trend-up { color: var(--green); }
  .trend-down { color: var(--red); }
  
  /* DASHBOARD TABS */
  .dash-tabs { display: flex; gap: 4px; border-bottom: 2px solid var(--border1); margin-bottom: 20px; overflow-x: auto; }
  .dash-tab { font-family: 'IBM Plex Mono', monospace; font-size: 0.75rem; padding: 10px 16px; border: none; background: none; cursor: pointer; color: var(--text3); letter-spacing: 0.05em; border-bottom: 2px solid transparent; margin-bottom: -2px; white-space: nowrap; transition: all 0.2s; display: flex; align-items: center; gap: 6px; }
  .dash-tab.active { color: var(--navy); border-bottom-color: var(--navy); font-weight: 700; }
  .dash-tab:hover { color: var(--navy); }
  
  /* CHART WRAPPER */
  .chart-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 24px; }
  @media(max-width:900px){ .chart-grid { grid-template-columns: 1fr; } }
  .chart-card { background: white; border: 1px solid var(--border1); border-radius: 12px; padding: 20px; box-shadow: var(--shadow); }
  .chart-title { font-family: 'DM Serif Display', serif; font-size: 1rem; color: var(--text1); margin-bottom: 4px; }
  .chart-sub { font-family: 'IBM Plex Mono', monospace; font-size: 0.7rem; color: var(--text3); margin-bottom: 16px; }
  
  /* ZONE TABLE */
  .zone-table { width: 100%; border-collapse: collapse; background: white; border-radius: 12px; overflow: hidden; box-shadow: var(--shadow); }
  .zone-table th { background: var(--navy); color: white; padding: 12px 16px; text-align: left; font-family: 'IBM Plex Mono', monospace; font-size: 0.7rem; letter-spacing: 0.06em; white-space: nowrap; }
  .zone-table td { padding: 12px 16px; border-bottom: 1px solid var(--border1); font-size: 0.85rem; vertical-align: middle; }
  .zone-table tr:last-child td { border-bottom: none; }
  .zone-table tr:hover td { background: var(--bg2); }
  .zone-table tr.total-row td { background: var(--bg2); font-weight: 700; border-top: 2px solid var(--border2); }
  .status-badge { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 20px; font-family: 'IBM Plex Mono', monospace; font-size: 0.65rem; font-weight: 700; letter-spacing: 0.05em; }
  .status-good { background: #E8FFF5; color: #00A878; }
  .status-warning { background: #FFF7ED; color: #E8871E; }
  .status-bad { background: #FFF0EF; color: #D93025; }
  
  /* QUEUE CARDS */
  .queue-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
  .queue-card { background: white; border: 1.5px solid var(--border1); border-radius: 12px; padding: 20px; }
  .queue-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border1); }
  .queue-zone-name { font-family: 'DM Serif Display', serif; font-size: 1rem; color: var(--text1); }
  .queue-param-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 12px; }
  .queue-param { background: var(--bg2); border-radius: 8px; padding: 10px; }
  .queue-param-label { font-family: 'IBM Plex Mono', monospace; font-size: 0.65rem; color: var(--text3); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 3px; }
  .queue-param-value { font-family: 'IBM Plex Mono', monospace; font-size: 1rem; font-weight: 700; color: var(--text1); }
  .queue-insight { background: #EBF5FF; border-left: 3px solid var(--navy); border-radius: 0 8px 8px 0; padding: 10px 12px; font-size: 0.8rem; color: var(--text2); line-height: 1.5; margin-top: 12px; }
  
  /* THEORY CARDS */
  .theory-card { background: white; border: 1.5px solid var(--border1); border-radius: 12px; padding: 24px; margin-bottom: 16px; border-left: 5px solid var(--navy); }
  .theory-concept { font-family: 'IBM Plex Mono', monospace; font-size: 0.65rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text3); margin-bottom: 6px; }
  .theory-title { font-family: 'DM Serif Display', serif; font-size: 1.1rem; color: var(--text1); margin-bottom: 12px; }
  .theory-body { font-size: 0.9rem; color: var(--text2); line-height: 1.7; margin-bottom: 12px; }
  .theory-formula { background: var(--bg2); border: 1px solid var(--border1); border-radius: 8px; padding: 10px 14px; font-family: 'IBM Plex Mono', monospace; font-size: 0.78rem; color: var(--text1); margin-bottom: 10px; }
  .theory-suggestion { background: #F0FFF8; border-left: 3px solid var(--green); border-radius: 0 8px 8px 0; padding: 10px 14px; font-size: 0.85rem; color: var(--text2); display: flex; align-items: flex-start; gap: 8px; }
  
  /* DECISION PANELS */
  .decision-layout { display: flex; gap: 20px; }
  .decision-nav { width: 200px; flex-shrink: 0; }
  .decision-nav-item { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 8px; cursor: pointer; transition: all 0.15s; font-size: 0.85rem; color: var(--text2); border: 1.5px solid transparent; margin-bottom: 4px; }
  .decision-nav-item:hover { background: var(--bg2); color: var(--navy); }
  .decision-nav-item.active { border-color: var(--navy); background: #EBF5FF; color: var(--navy); font-weight: 600; }
  .decision-nav-item .badge { margin-left: auto; font-family: 'IBM Plex Mono', monospace; font-size: 0.65rem; background: var(--green); color: white; border-radius: 4px; padding: 1px 6px; }
  .decision-main { flex: 1; min-width: 0; }
  .decision-panel { background: white; border: 1px solid var(--border1); border-radius: 12px; overflow: hidden; }
  .decision-panel-header { background: var(--navy); color: white; padding: 18px 24px; display: flex; align-items: center; gap: 10px; }
  .decision-panel-title { font-family: 'DM Serif Display', serif; font-size: 1.1rem; }
  .decision-panel-body { padding: 24px; }
  
  /* INPUTS */
  .input-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
  @media(max-width:700px){ .input-grid { grid-template-columns: repeat(2,1fr); } }
  .input-group { background: var(--bg2); border-radius: 10px; padding: 14px; }
  .input-label { font-family: 'IBM Plex Mono', monospace; font-size: 0.7rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text3); margin-bottom: 6px; }
  .num-input { width: 100%; border: 1.5px solid var(--border2); border-radius: 6px; padding: 8px 12px; font-family: 'IBM Plex Mono', monospace; font-size: 0.9rem; color: var(--text1); background: white; outline: none; transition: border-color 0.2s; }
  .num-input:focus { border-color: var(--navy); }
  .range-input { width: 100%; accent-color: var(--navy); margin: 6px 0; }
  .select-input { width: 100%; border: 1.5px solid var(--border2); border-radius: 6px; padding: 8px 12px; font-family: 'IBM Plex Mono', monospace; font-size: 0.85rem; color: var(--text1); background: white; outline: none; cursor: pointer; }
  
  /* STRATEGY BUTTONS */
  .strategy-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
  .strategy-card { border: 2px solid var(--border2); border-radius: 10px; padding: 16px; cursor: pointer; transition: all 0.2s; text-align: center; }
  .strategy-card:hover { border-color: var(--navy); }
  .strategy-card.selected { border-color: var(--navy); background: #EBF5FF; }
  .strategy-name { font-family: 'DM Serif Display', serif; font-size: 1rem; color: var(--text1); margin-bottom: 4px; }
  .strategy-sub { font-size: 0.78rem; color: var(--text3); }
  
  /* INSTALL TABLE */
  .install-table { width: 100%; border-collapse: collapse; }
  .install-table th { background: var(--bg2); padding: 10px 12px; text-align: center; font-family: 'IBM Plex Mono', monospace; font-size: 0.7rem; color: var(--text3); letter-spacing: 0.06em; text-transform: uppercase; border-bottom: 1px solid var(--border1); }
  .install-table td { padding: 10px 12px; border-bottom: 1px solid var(--border1); text-align: center; vertical-align: middle; }
  .install-table td:first-child { text-align: left; }
  .install-num { width: 70px; border: 1.5px solid var(--border2); border-radius: 6px; padding: 6px 10px; font-family: 'IBM Plex Mono', monospace; font-size: 0.9rem; text-align: center; background: white; outline: none; }
  .install-num:focus { border-color: var(--navy); }
  .current-badge { display: inline-block; background: var(--bg2); border: 1px solid var(--border1); border-radius: 4px; padding: 2px 8px; font-family: 'IBM Plex Mono', monospace; font-size: 0.75rem; color: var(--text2); }
  
  /* SUMMARY PANEL */
  .summary-box { background: var(--bg2); border: 1.5px solid var(--border1); border-radius: 12px; padding: 20px; }
  .summary-title { font-family: 'DM Serif Display', serif; font-size: 1rem; color: var(--navy); margin-bottom: 16px; padding-bottom: 10px; border-bottom: 1px solid var(--border1); }
  .summary-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border1); font-size: 0.85rem; }
  .summary-row:last-child { border-bottom: none; }
  .summary-key { color: var(--text3); font-family: 'IBM Plex Mono', monospace; font-size: 0.75rem; }
  .summary-val { font-weight: 600; color: var(--text1); font-family: 'IBM Plex Mono', monospace; font-size: 0.8rem; }
  .profit-positive { color: var(--green); }
  .profit-negative { color: var(--red); }
  
  /* EVENT ALERTS */
  .event-alert { border-radius: 10px; padding: 16px 20px; margin-bottom: 12px; border-left: 5px solid; display: flex; gap: 14px; align-items: flex-start; }
  .event-alert.warning { background: #FFF8ED; border-left-color: var(--amber); }
  .event-alert.danger { background: #FFF0EF; border-left-color: var(--red); }
  .event-alert.info { background: #EBF5FF; border-left-color: var(--blue); }
  .event-alert.success { background: #E8FFF5; border-left-color: var(--green); }
  .event-title { font-family: 'DM Serif Display', serif; font-size: 0.95rem; color: var(--text1); margin-bottom: 4px; }
  .event-body { font-size: 0.85rem; color: var(--text2); line-height: 1.5; }
  .event-theory { font-family: 'IBM Plex Mono', monospace; font-size: 0.7rem; color: var(--text3); margin-top: 6px; }
  
  /* INCOME STATEMENT */
  .income-statement { background: white; border: 1px solid var(--border1); border-radius: 12px; overflow: hidden; }
  .income-header { background: var(--navy); color: white; padding: 16px 20px; font-family: 'DM Serif Display', serif; font-size: 1rem; }
  .income-body { padding: 20px; }
  .income-section { margin-bottom: 16px; }
  .income-section-title { font-family: 'IBM Plex Mono', monospace; font-size: 0.7rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text3); margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid var(--border1); }
  .income-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 0.85rem; color: var(--text2); }
  .income-row.sub { padding-left: 16px; color: var(--text3); font-size: 0.8rem; }
  .income-row.total { border-top: 2px solid var(--border2); padding-top: 8px; margin-top: 4px; font-weight: 700; font-family: 'IBM Plex Mono', monospace; font-size: 0.85rem; color: var(--text1); }
  .income-row.net { border-top: 3px double var(--navy); padding-top: 10px; margin-top: 6px; font-weight: 700; font-family: 'IBM Plex Mono', monospace; font-size: 1rem; }
  
  /* REVIEW */
  .review-wrap { min-height: 100vh; background: #f8f9ff; padding: 40px 20px; }
  .review-card { max-width: 900px; margin: 0 auto; background: white; border-radius: 20px; padding: 48px; box-shadow: var(--shadow-lg); }
  .review-title { font-family: 'DM Serif Display', serif; font-size: 2rem; color: var(--navy); margin-bottom: 4px; }
  .review-sub { font-family: 'IBM Plex Mono', monospace; font-size: 0.75rem; color: var(--text3); letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 32px; }
  .scorecard-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  .scorecard-table th { background: var(--navy); color: white; padding: 10px 16px; font-family: 'IBM Plex Mono', monospace; font-size: 0.7rem; letter-spacing: 0.05em; text-align: left; }
  .scorecard-table td { padding: 10px 16px; border-bottom: 1px solid var(--border1); font-size: 0.9rem; }
  .scorecard-table .total-row td { background: var(--bg2); font-weight: 700; border-top: 2px solid var(--border2); }
  .strength { background: #E8FFF5; border-left: 4px solid var(--green); border-radius: 0 8px 8px 0; padding: 12px 16px; margin-bottom: 10px; font-size: 0.9rem; color: var(--text2); }
  .improvement { background: #FFF7ED; border-left: 4px solid var(--amber); border-radius: 0 8px 8px 0; padding: 12px 16px; margin-bottom: 10px; font-size: 0.9rem; color: var(--text2); }
  
  /* FINAL */
  .final-wrap { min-height: 100vh; background: #f0f4ff; padding: 40px 20px; }
  .final-card { max-width: 900px; margin: 0 auto; background: white; border-radius: 20px; padding: 48px; box-shadow: var(--shadow-lg); }
  .certificate { border: 3px double var(--navy); border-radius: 20px; padding: 48px; text-align: center; background: linear-gradient(135deg, #f8f9ff 0%, #f0faf7 100%); margin-top: 32px; }
  .cert-title { font-family: 'DM Serif Display', serif; font-size: 1.8rem; color: var(--navy); margin-bottom: 8px; }
  .cert-sub { font-family: 'IBM Plex Mono', monospace; font-size: 0.75rem; color: var(--text3); letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 24px; }
  .cert-name { font-family: 'DM Serif Display', serif; font-size: 2.5rem; color: var(--text1); border-bottom: 2px solid var(--navy); display: inline-block; padding-bottom: 4px; margin-bottom: 24px; }
  .cert-grade { font-family: 'IBM Plex Mono', monospace; font-size: 4rem; font-weight: 700; margin-bottom: 8px; }
  .cert-score { font-family: 'IBM Plex Mono', monospace; font-size: 1.2rem; color: var(--text2); margin-bottom: 24px; }
  .cert-metrics { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; max-width: 400px; margin: 0 auto; }
  .cert-metric { background: var(--bg2); border-radius: 8px; padding: 12px; }
  .cert-metric-label { font-family: 'IBM Plex Mono', monospace; font-size: 0.65rem; color: var(--text3); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }
  .cert-metric-value { font-family: 'IBM Plex Mono', monospace; font-size: 1.1rem; font-weight: 700; color: var(--navy); }
  
  .util-bar-wrap { background: var(--border1); border-radius: 4px; height: 8px; margin-top: 4px; overflow: hidden; }
  .util-bar { height: 100%; border-radius: 4px; transition: width 0.5s; }
  
  .loading-screen { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; background: white; }
  .loading-title { font-family: 'DM Serif Display', serif; font-size: 1.5rem; color: var(--navy); margin-bottom: 8px; }
  .loading-sub { font-family: 'IBM Plex Mono', monospace; font-size: 0.75rem; color: var(--text3); margin-bottom: 32px; }
  .loading-bar-wrap { width: 300px; background: var(--border1); border-radius: 8px; height: 6px; overflow: hidden; }
  .loading-bar { height: 100%; background: linear-gradient(90deg, var(--navy), var(--green)); border-radius: 8px; animation: loadAnim 2s ease-in-out; }
  @keyframes loadAnim { from{width:0%} to{width:100%} }
  .loading-steps { display: flex; flex-direction: column; gap: 8px; margin-top: 24px; }
  .loading-step { font-family: 'IBM Plex Mono', monospace; font-size: 0.75rem; color: var(--text3); display: flex; align-items: center; gap: 8px; animation: fadeIn 0.3s forwards; opacity: 0; }
  .loading-step:nth-child(1){animation-delay:0.2s}
  .loading-step:nth-child(2){animation-delay:0.6s}
  .loading-step:nth-child(3){animation-delay:1.0s}
  .loading-step:nth-child(4){animation-delay:1.4s}
  @keyframes fadeIn { to{opacity:1} }
  
  .number-stepper { display: flex; align-items: center; gap: 8px; }
  .stepper-btn { width: 28px; height: 28px; border: 1.5px solid var(--border2); background: white; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 1rem; color: var(--text2); transition: all 0.15s; line-height: 1; font-weight: 700; flex-shrink: 0; }
  .stepper-btn:hover { border-color: var(--navy); color: var(--navy); background: #EBF5FF; }
  .stepper-val { font-family: 'IBM Plex Mono', monospace; font-size: 1rem; font-weight: 700; color: var(--text1); min-width: 28px; text-align: center; }
  
  .context-banner { background: linear-gradient(135deg, #EBF5FF, #f0faf7); border: 1.5px solid var(--border1); border-radius: 12px; padding: 20px 24px; margin-bottom: 20px; display: flex; gap: 20px; align-items: flex-start; }
  .context-quarter { font-family: 'IBM Plex Mono', monospace; font-size: 2rem; font-weight: 700; color: var(--navy); line-height: 1; }
  .context-info { flex: 1; }
  .context-period { font-family: 'IBM Plex Mono', monospace; font-size: 0.75rem; color: var(--text3); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 4px; }
  .context-season { font-family: 'DM Serif Display', serif; font-size: 1.2rem; color: var(--text1); margin-bottom: 4px; }
  .context-desc { font-size: 0.9rem; color: var(--text2); line-height: 1.5; }
  
  .section-header { font-family: 'DM Serif Display', serif; font-size: 1.2rem; color: var(--text1); margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid var(--border1); display: flex; align-items: center; gap: 8px; }
  .section-subheader { font-family: 'IBM Plex Mono', monospace; font-size: 0.7rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text3); margin-bottom: 12px; }
  
  .eoq-comparison { display: grid; grid-template-columns: repeat(2,1fr); gap: 16px; margin-top: 16px; }
  .eoq-box { background: var(--bg2); border-radius: 10px; padding: 16px; border: 1.5px solid var(--border1); }
  .eoq-box.highlight { border-color: var(--green); background: #E8FFF5; }
  .eoq-box-label { font-family: 'IBM Plex Mono', monospace; font-size: 0.7rem; color: var(--text3); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }
  .eoq-box-value { font-family: 'IBM Plex Mono', monospace; font-size: 1.4rem; font-weight: 700; color: var(--text1); }
  .eoq-box-cost { font-size: 0.8rem; color: var(--text3); margin-top: 4px; }
  
  .page-title { font-family: 'DM Serif Display', serif; font-size: 1.5rem; color: var(--navy); margin-bottom: 4px; }
  .page-sub { font-family: 'IBM Plex Mono', monospace; font-size: 0.7rem; color: var(--text3); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 20px; }
  
  .forecast-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 20px; }
  .forecast-card { background: white; border: 1px solid var(--border1); border-radius: 10px; padding: 14px; text-align: center; }
  .forecast-zone { font-family: 'IBM Plex Mono', monospace; font-size: 0.65rem; color: var(--text3); text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.06em; }
  .forecast-val { font-family: 'IBM Plex Mono', monospace; font-size: 1.3rem; font-weight: 700; color: var(--navy); }
  .forecast-unit { font-family: 'IBM Plex Mono', monospace; font-size: 0.65rem; color: var(--text3); }

  .section-break { height: 1px; background: var(--border1); margin: 20px 0; }
  
  .grid-2 { display: grid; grid-template-columns: repeat(2,1fr); gap: 20px; }
  @media(max-width:700px){.grid-2{grid-template-columns:1fr}}
  
  .col-green { color: var(--green); }
  .col-red { color: var(--red); }
  .col-amber { color: var(--amber); }
  .col-navy { color: var(--navy); }
  
  .tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-family: 'IBM Plex Mono', monospace; font-size: 0.65rem; font-weight: 700; letter-spacing: 0.05em; }
  .tag-green { background: #E8FFF5; color: var(--green); }
  .tag-amber { background: #FFF7ED; color: var(--amber); }
  .tag-red { background: #FFF0EF; color: var(--red); }
  .tag-navy { background: #EBF5FF; color: var(--navy); }
  
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: var(--bg2); }
  ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 3px; }
  
  .fade-in { animation: fadeIn 0.4s forwards; }
`;

// ============================================================
// HELPER COMPONENTS
// ============================================================

function fmt(n) {
  if (n === undefined || n === null || isNaN(n)) return "₹0";
  const abs = Math.abs(n);
  if (abs >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
  if (abs >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function getGrade(score) {
  if (score >= 90) return { grade: "A", label: "Exceptional", color: "#00A878" };
  if (score >= 75) return { grade: "B", label: "Proficient", color: "#0A4F8C" };
  if (score >= 60) return { grade: "C", label: "Developing", color: "#E8871E" };
  return { grade: "D", label: "Needs Improvement", color: "#D93025" };
}

function getUtilColor(u) {
  if (u >= 70 && u <= 85) return "#00A878";
  if (u >= 55 && u < 70) return "#E8871E";
  if (u > 85 && u <= 92) return "#E8871E";
  return "#D93025";
}

function getWqColor(wq) {
  if (wq < 10) return "#00A878";
  if (wq < 20) return "#E8871E";
  return "#D93025";
}

function NumberStepper({ value, onChange, min = 0, max = 20 }) {
  return (
    <div className="number-stepper">
      <button className="stepper-btn" onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <span className="stepper-val">{value}</span>
      <button className="stepper-btn" onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </div>
  );
}

// ============================================================
// LANDING PAGE
// ============================================================

function LandingPage({ onStart }) {
  const [activeTab, setActiveTab] = useState(0);
  const [playerName, setPlayerName] = useState("");
  const [institution, setInstitution] = useState("");
  const [difficulty, setDifficulty] = useState("STANDARD");
  const [apPref, setApPref] = useState("LEVEL");

  const formulaTabs = [
    { label: "Aggregate Planning", formulas: ["Pt = Dt + (It-1 – It)  — Production = Demand + Inventory change", "Chase: Hire/Fire to match demand each period", "Level: Constant workforce, absorb with overtime/undertime", "OT Cost = Regular Rate × 1.5 × OT Hours", "Undertime Cost = Wage Rate × Idle Hours"] },
    { label: "Capacity Planning", formulas: ["Utilization = Actual Output / Design Capacity × 100%", "Efficiency = Actual Output / Effective Capacity × 100%", "Break-even Vol = Fixed Cost / (Price – Variable Cost)", "Machines Needed = (Demand × Processing Time) / (Avail Time × Util)"] },
    { label: "Inventory", formulas: ["EOQ = √(2DS/H)  where D=demand, S=ordering cost, H=holding", "ROP = d̄×L + z×σd×√L  (Reorder Point formula)", "Safety Stock = z × σd × √L", "Total Inv Cost = (D/Q)×S + (Q/2)×H + Unit Cost×D", "Avg Inventory = Q/2 + Safety Stock"] },
    { label: "Queuing (M/M/c)", formulas: ["ρ = λ/(c×μ)  — Server utilization", "P₀ = [Σ(λ/μ)ⁿ/n! + (λ/μ)^c/(c!(1-ρ))]⁻¹", "Lq = P₀(λ/μ)^c × ρ / [c!(1-ρ)²]", "Wq = Lq / λ  (avg wait in queue)", "L = Lq + λ/μ  |  W = Wq + 1/μ", "Service Level = P(wait < T) = 1 – Erlang-C × e^(-(cμ-λ)T)"] }
  ];

  return (
    <div className="app">
      {/* HERO */}
      <section className="hero">
        <div className="hero-content fade-in">
          <div className="hero-supertitle">Operations Management Simulation — Ranchi, Jharkhand</div>
          <h1 className="hero-title">Volt<span>Grid</span></h1>
          <p className="hero-sub">Build. Operate. Optimize. Lead Ranchi's EV Revolution.</p>
          <div className="bolt-grid">
            {[{ bg: "#EBF5FF", c: "#0A4F8C" }, { bg: "#E8FFF5", c: "#00A878" }, { bg: "#FFF7ED", c: "#E8871E" }].map((s, i) => (
              <div className="bolt-icon" key={i} style={{ background: s.bg }}><Zap size={22} color={s.c} /></div>
            ))}
          </div>
          <p className="hero-desc">Ranchi is electrifying. Your company, VoltGrid Pvt. Ltd., has won the state contract to operate EV charging networks across 5 city zones. Over 6 quarters, apply real Operations Management principles to build a profitable, high-service charging empire.</p>
          <div>
            <button className="btn-primary" onClick={() => document.getElementById("setup").scrollIntoView({ behavior: "smooth" })}>Enter Simulation <ArrowRight size={16} /></button>
            <button className="btn-secondary" onClick={() => document.getElementById("context").scrollIntoView({ behavior: "smooth" })}>Read Briefing ↓</button>
          </div>
        </div>
      </section>

      {/* CONTEXT */}
      <section className="section" id="context">
        <div className="section-label">Your Mission</div>
        <h2 className="section-title">The VoltGrid Challenge</h2>
        <div className="grid-2">
          <div>
            <p style={{ fontSize: "0.95rem", color: "var(--text2)", lineHeight: 1.8, marginBottom: 16 }}>Jharkhand registered <strong>12,400 EVs in 2024</strong> — a 340% surge from 2021. Yet Ranchi has only 23 public charging stations. The gap is enormous. JUVNL is pushing for 500 charging points by 2027.</p>
            <p style={{ fontSize: "0.95rem", color: "var(--text2)", lineHeight: 1.8, marginBottom: 16 }}>VoltGrid Pvt. Ltd. has secured a 5-zone operating contract. Your task: install chargers, manage workforce, procure energy, set prices, and optimize queues — all while staying profitable over 6 quarters (18 months).</p>
            <p style={{ fontSize: "0.95rem", color: "var(--text2)", lineHeight: 1.8 }}>Every decision you make is rooted in Operations Management theory. The simulation engine calculates real M/M/c queue metrics, EOQ costs, aggregate planning trade-offs, and capacity utilization — just like in practice.</p>
          </div>
          <div className="zone-grid">
            {ZONES.map(z => (
              <div className="zone-card" key={z.id} style={{ borderLeft: `4px solid ${z.color}` }}>
                <div className="zone-name">{z.name}</div>
                <div className="zone-type">{z.type}</div>
                <div className="zone-demand"><Battery size={14} color={z.color} /><span>{BASE_DEMAND[z.id]} EVs/day base demand</span></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <hr className="section-divider" />

      {/* RULES */}
      <section className="section" id="rules">
        <div className="section-label">How It Works</div>
        <h2 className="section-title">Simulation Rules</h2>
        <div className="grid-2">
          {["6 Decision Rounds = 6 quarters (Q1 2025 — Q2 2026). Each round: decisions → engine run → results.", "Demand fluctuates seasonally. Q2 (summer) and Q4 (festivals) are peak. Q3 (monsoon) is lowest.", "You manage 5 zones with shared capital. Install chargers, hire staff, order inventory — all from ₹50L.", "Random events (outages, demand spikes, competition) may occur. Your OM knowledge helps mitigate them.", "All calculations are transparent. Click any metric to see the formula that produced it.", "Theory feedback appears after every round, linking your results to OM concepts from your course.", "Mid-term reviews after Q2 and Q4. Final report + academic grade after Q6.", "Score is weighted: Q1-Q2: 10% each, Q3-Q4: 15% each, Q5-Q6: 25% each."].map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--border1)" }}>
              <div style={{ width: 28, height: 28, background: "var(--navy)", color: "white", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.75rem", fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
              <p style={{ fontSize: "0.9rem", color: "var(--text2)", lineHeight: 1.6 }}>{r}</p>
            </div>
          ))}
        </div>
      </section>

      <hr className="section-divider" />

      {/* OM CONCEPTS */}
      <section className="section">
        <div className="section-label">Academic Content</div>
        <h2 className="section-title">OM Concepts You Will Apply</h2>
        <div className="concept-grid">
          {[
            { title: "Aggregate Planning", color: "var(--navy)", icon: <Calendar size={20} />, desc: "Match workforce and charging capacity to forecasted demand using Chase, Level, or Mixed strategies. Experience the cost trade-offs between hiring/firing staff, overtime, and excess capacity.", tags: ["Chase Strategy", "Level Strategy", "Mixed Strategy", "Overtime Cost", "Undertime"] },
            { title: "Capacity Planning", color: "var(--green)", icon: <Battery size={20} />, desc: "Decide how many chargers to install, when to expand, and how to allocate capacity across zones. Use break-even analysis, utilization rates, and the theory of constraints.", tags: ["Utilization Rate", "Break-even", "Bottleneck", "Design Capacity", "Effective Capacity"] },
            { title: "Inventory Management", color: "var(--amber)", icon: <Package size={20} />, desc: "Manage energy storage and spare parts using EOQ to minimize total inventory cost, set reorder points, and calculate safety stock to prevent costly stockouts.", tags: ["EOQ", "Reorder Point", "Safety Stock", "Holding Cost", "Lead Time"] },
            { title: "Queuing Theory", color: "var(--blue)", icon: <Users size={20} />, desc: "Model charging stations as M/M/c queuing systems. Optimize server count to minimize customer wait time and total queuing cost while hitting service level targets.", tags: ["M/M/c Model", "Arrival Rate λ", "Service Rate μ", "Utilization ρ", "Wq | Lq"] }
          ].map((c, i) => (
            <div className="concept-card" key={i} style={{ borderLeftColor: c.color }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div style={{ background: c.color + "15", color: c.color, padding: 8, borderRadius: 8 }}>{c.icon}</div>
                <div className="concept-title">{c.title}</div>
              </div>
              <div className="concept-desc">{c.desc}</div>
              <div className="concept-tags">{c.tags.map(t => <span className="concept-tag" key={t}>{t}</span>)}</div>
            </div>
          ))}
        </div>
      </section>

      <hr className="section-divider" />

      {/* METRICS */}
      <section className="section">
        <div className="section-label">Evaluation</div>
        <h2 className="section-title">How You Will Be Scored</h2>
        <table className="metrics-table">
          <thead><tr><th>Dimension</th><th>Metric</th><th>Target</th><th>Weight</th></tr></thead>
          <tbody>
            {[["Operational", "Average Charger Utilization", "70–85%", "20%"], ["Operational", "Service Level (served in <15 min)", "≥85%", "20%"], ["Financial", "Quarterly Net Profit", ">₹0", "25%"], ["Financial", "Cost per Charging Session", "Minimize", "15%"], ["Inventory", "Stockout Events", "0", "10%"], ["Planning", "Forecast Accuracy (MAPE)", "<20%", "10%"]].map((r, i) => (
              <tr key={i}><td><span className="tag tag-navy">{r[0]}</span></td><td>{r[1]}</td><td><strong>{r[2]}</strong></td><td><strong>{r[3]}</strong></td></tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: "flex", gap: 16, marginTop: 20, flexWrap: "wrap" }}>
          {[["A", "90-100", "#00A878", "Exceptional"], ["B", "75-89", "#0A4F8C", "Proficient"], ["C", "60-74", "#E8871E", "Developing"], ["D", "<60", "#D93025", "Needs Work"]].map(([g, r, c, l]) => (
            <div key={g} style={{ background: c + "10", border: `2px solid ${c}`, borderRadius: 10, padding: "10px 20px", textAlign: "center" }}>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "1.5rem", fontWeight: 700, color: c }}>{g}</div>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.7rem", color: c }}>{r}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text3)", marginTop: 2 }}>{l}</div>
            </div>
          ))}
        </div>
      </section>

      <hr className="section-divider" />

      {/* FORMULA REFERENCE */}
      <section className="section">
        <div className="section-label">Quick Reference</div>
        <h2 className="section-title">OM Formulas You'll Use</h2>
        <div className="formula-tabs">
          {formulaTabs.map((t, i) => <button key={i} className={`formula-tab ${activeTab === i ? "active" : ""}`} onClick={() => setActiveTab(i)}>{t.label}</button>)}
        </div>
        <div className="formula-box">
          {formulaTabs[activeTab].formulas.map((f, i) => <div className="formula-item" key={i}>{f}</div>)}
        </div>
      </section>

      <hr className="section-divider" />

      {/* SETUP */}
      <section className="section" id="setup">
        <div className="section-label">Get Started</div>
        <h2 className="section-title">Set Up Your Profile</h2>
        <div className="setup-card">
          <div className="setup-title">Ready to run VoltGrid?</div>
          <div className="form-group">
            <label className="form-label">Your Name *</label>
            <input className="form-input" placeholder="Enter your name" value={playerName} onChange={e => setPlayerName(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Institution (optional)</label>
            <input className="form-input" placeholder="Your college / university" value={institution} onChange={e => setInstitution(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Difficulty Level</label>
            <div className="radio-group">
              {[["STANDARD", "Standard", "Classroom recommended"], ["ADVANCED", "Advanced", "Higher variability"]].map(([v, l, s]) => (
                <div key={v} className={`radio-option ${difficulty === v ? "selected" : ""}`} onClick={() => setDifficulty(v)}>
                  <span className="radio-option-label">{l}</span>
                  <span className="radio-option-sub">{s}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Starting AP Preference</label>
            <div className="radio-group">
              {[["CHASE", "Chase", "Match demand"], ["LEVEL", "Level", "Stable workforce"], ["MIXED", "Mixed", "Balanced"]].map(([v, l, s]) => (
                <div key={v} className={`radio-option ${apPref === v ? "selected" : ""}`} onClick={() => setApPref(v)}>
                  <span className="radio-option-label">{l}</span>
                  <span className="radio-option-sub">{s}</span>
                </div>
              ))}
            </div>
          </div>
          <button className="btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 8 }} onClick={() => { if (playerName.trim()) onStart({ playerName: playerName.trim(), institution, difficulty, apPref }); }}>
            Begin Operations as VoltGrid Manager <ArrowRight size={18} />
          </button>
        </div>
      </section>
      <div style={{ height: 80 }} />
    </div>
  );
}

// ============================================================
// BRIEFING MODULE
// ============================================================

function BriefingModule({ state, dispatch }) {
  const step = state.briefingStep;
  const steps = [
    {
      title: "Welcome to VoltGrid",
      sub: "Board of Directors Brief — Q1 2025",
      content: (
        <div>
          <div className="briefing-letter">
            <p><strong>Dear Operations Manager,</strong></p>
            <br />
            <p>Congratulations on your appointment as Chief Operations Manager of VoltGrid Pvt. Ltd. The Board is excited to commence our EV charging operations across Ranchi's five strategic zones.</p>
            <br />
            <p>You have been allocated an initial capital of <strong>₹50,00,000</strong> (50 Lakhs) to build and operate this network. Your mandate is to achieve profitability within 6 quarters while maintaining excellent service quality. Every quarter, you will submit operational decisions that the simulation engine will evaluate using real OM models.</p>
            <br />
            <p>The Board expects monthly reports on charger utilization, service levels, inventory costs, and workforce efficiency. We trust your OM expertise to optimize operations.</p>
            <br />
            <p>Best regards,<br /><strong>The Board of Directors, VoltGrid Pvt. Ltd.</strong></p>
          </div>
        </div>
      )
    },
    {
      title: "Your Starting Position",
      sub: "Initial Conditions — As of January 2025",
      content: (
        <table className="briefing-table">
          <tbody>
            {[["Starting Capital", "₹50,00,000 (50 Lakhs)"], ["Installed Chargers", "0 across all 5 zones"], ["Technicians", "10 (can be adjusted)"], ["Energy Contracts", "None (must be negotiated)"], ["Battery Storage", "100 kWh initial buffer"], ["Spare Parts", "500 units (minimum)"], ["Fixed Monthly Costs", "₹3,00,000 (HQ + licenses + lease)"], ["Growth Rate", "8% demand growth per quarter"], ["Operating Hours", "6 AM – Midnight (18 hrs/day)"]].map(([k, v]) => (
              <tr key={k}><td>{k}</td><td>{v}</td></tr>
            ))}
          </tbody>
        </table>
      )
    },
    {
      title: "Your Decision Framework",
      sub: "8 Categories of Operational Decisions",
      content: (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10 }}>
            {[["1. Capacity Planning", "Charger installation by zone & type"], ["2. Aggregate Planning", "Workforce levels & strategy (Chase/Level/Mixed)"], ["3. Inventory Management", "Energy storage & spare parts orders (EOQ)"], ["4. Queue Policy", "Max queue length, priority rules"], ["5. Pricing Strategy", "Per-session pricing by charger type"], ["6. Energy Procurement", "Contract type & volume"], ["7. Maintenance", "Preventive vs reactive scheduling"], ["8. Zone Strategy", "Marketing budget & priorities"]].map(([t, s]) => (
              <div key={t} style={{ background: "var(--bg2)", borderRadius: 8, padding: "12px 14px", borderLeft: "3px solid var(--navy)" }}>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.8rem", fontWeight: 700, color: "var(--navy)", marginBottom: 2 }}>{t}</div>
                <div style={{ fontSize: "0.8rem", color: "var(--text3)" }}>{s}</div>
              </div>
            ))}
          </div>
          <div style={{ background: "#EBF5FF", borderLeft: "4px solid var(--navy)", borderRadius: "0 8px 8px 0", padding: "14px 16px", marginTop: 20 }}>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.7rem", color: "var(--navy)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>💡 Pro Tip</div>
            <p style={{ fontSize: "0.85rem", color: "var(--text2)" }}>Start Q1 with at least 2 Fast DC chargers at Main Road (highest demand: 90/day). Install Slow chargers in Doranda (lowest demand: 40/day) to conserve capital.</p>
          </div>
        </div>
      )
    }
  ];

  return (
    <div className="briefing-wrap">
      <div className="briefing-card">
        <div className="briefing-progress">
          {steps.map((_, i) => <div key={i} className={`briefing-dot ${i < step ? "done" : i === step ? "active" : ""}`} />)}
        </div>
        <div className="briefing-step-title">{steps[step].title}</div>
        <div className="briefing-step-sub">{steps[step].sub}</div>
        {steps[step].content}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 28 }}>
          {step > 0 ? <button className="btn-outline" onClick={() => dispatch({ type: "SET_BRIEFING_STEP", payload: step - 1 })}>← Back</button> : <div />}
          {step < steps.length - 1
            ? <button className="btn-primary" onClick={() => dispatch({ type: "SET_BRIEFING_STEP", payload: step + 1 })}>Next <ChevronRight size={16} /></button>
            : <button className="btn-green" onClick={() => dispatch({ type: "START_ROUND" })}>Proceed to Decision Panel <ArrowRight size={16} /></button>}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// DECISION PANELS
// ============================================================

function CapacityPanel({ decisions, installations, dispatch, capital }) {
  const totalInstallCost = ZONES.reduce((acc, z) =>
    acc + ["SLOW", "FAST", "ULTRA"].reduce((a, t) =>
      a + (decisions.newInstall?.[z.id]?.[t] || 0) * CHARGER_TYPES[t].installCost, 0), 0);

  return (
    <div className="decision-panel">
      <div className="decision-panel-header">
        <Battery size={18} />
        <div className="decision-panel-title">Charger Installation & Zone Allocation</div>
      </div>
      <div className="decision-panel-body">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: totalInstallCost > capital ? "#FFF0EF" : "#E8FFF5", borderRadius: 8, padding: "10px 16px", marginBottom: 20, border: `1.5px solid ${totalInstallCost > capital ? "var(--red)" : "var(--green)"}` }}>
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.8rem", color: "var(--text2)" }}>Installation Cost Preview</span>
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "1.1rem", fontWeight: 700, color: totalInstallCost > capital ? "var(--red)" : "var(--green)" }}>{fmt(totalInstallCost)}</span>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 8, marginBottom: 8 }}>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.7rem", color: "var(--text3)", textTransform: "uppercase" }}>Zone</div>
            {["SLOW", "FAST", "ULTRA"].map(t => (
              <div key={t} style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.7rem", color: "var(--text3)", textTransform: "uppercase", textAlign: "center", minWidth: 90 }}>
                {CHARGER_TYPES[t].name.split("(")[0]}<br />
                <span style={{ color: CHARGER_TYPES[t].color }}>₹{(CHARGER_TYPES[t].installCost / 1000).toFixed(0)}K/unit</span>
              </div>
            ))}
          </div>
          {ZONES.map(z => (
            <div key={z.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 8, alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--border1)" }}>
              <div>
                <div style={{ fontFamily: "'Source Serif 4',serif", fontWeight: 600, fontSize: "0.9rem", color: "var(--text1)" }}>{z.name}</div>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.65rem", color: "var(--text3)" }}>{BASE_DEMAND[z.id]} EVs/day base</div>
              </div>
              {["SLOW", "FAST", "ULTRA"].map(t => {
                const current = installations[z.id]?.[t] || 0;
                const adding = decisions.newInstall?.[z.id]?.[t] || 0;
                return (
                  <div key={t} style={{ textAlign: "center", minWidth: 90 }}>
                    <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.65rem", color: "var(--text3)", marginBottom: 4 }}>Current: <strong>{current}</strong></div>
                    <NumberStepper value={adding} onChange={v => dispatch({ type: "UPDATE_INSTALL", zone: z.id, chargerType: t, value: v })} min={0} max={15} />
                    {adding > 0 && <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.65rem", color: CHARGER_TYPES[t].color, marginTop: 2 }}>+{fmt(adding * CHARGER_TYPES[t].installCost)}</div>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="theory-formula">Utilization = Actual Sessions / (Chargers × μ × 18hrs) × 100% | Break-even = Fixed Cost / (Revenue/session – Variable Cost/session)</div>
      </div>
    </div>
  );
}

function AggregatePlanningPanel({ decisions, state, dispatch }) {
  const strategy = decisions.apStrategy || "LEVEL";
  const totalC = ZONES.reduce((acc, z) => acc + ["SLOW","FAST","ULTRA"].reduce((a,t) => a + ((state.installations[z.id]?.[t]||0) + (decisions.newInstall?.[z.id]?.[t]||0)), 0), 0);
  const reqWorkers = Math.ceil(totalC / LABOR.chargersPerTech);
  const curW = state.workforce.currentWorkers;
  const hire = strategy === "CHASE" ? Math.max(0, reqWorkers - curW) : 0;
  const fire = strategy === "CHASE" ? Math.max(0, curW - reqWorkers) : 0;
  const laborCostEst = hire * LABOR.hiringCost + fire * LABOR.firingCost + (strategy === "CHASE" ? reqWorkers : curW) * LABOR.wagePerDay * LABOR.workdaysPerQ;

  return (
    <div className="decision-panel">
      <div className="decision-panel-header"><Calendar size={18} /><div className="decision-panel-title">Workforce & Aggregate Planning Strategy</div></div>
      <div className="decision-panel-body">
        <div className="strategy-grid">
          {[["CHASE", "Chase Strategy", "Hire/fire each period to match demand exactly"], ["LEVEL", "Level Strategy", "Constant workforce; use overtime/undertime buffer"], ["MIXED", "Mixed Strategy", "Partial adjustment plus authorized overtime"]].map(([v, n, d]) => (
            <div key={v} className={`strategy-card ${strategy === v ? "selected" : ""}`} onClick={() => dispatch({ type: "UPDATE_DECISION", payload: { apStrategy: v } })}>
              <div className="strategy-name">{n}</div>
              <div className="strategy-sub">{d}</div>
            </div>
          ))}
        </div>
        <div className="grid-2">
          <div className="summary-box">
            <div className="summary-title">Workforce Analysis</div>
            {[["Current Workers", curW], ["Required for Chargers", `${reqWorkers} (${totalC} chargers ÷ 8)`], ["Projected Target", strategy === "CHASE" ? reqWorkers : strategy === "LEVEL" ? curW : Math.ceil((curW + reqWorkers) / 2)], ["Hires Needed", hire > 0 ? `+${hire} @ ₹15K each` : "None"], ["Fires Needed", fire > 0 ? `-${fire} @ ₹20K each` : "None"], ["Est. Labor Cost", fmt(laborCostEst)]].map(([k, v]) => (
              <div className="summary-row" key={k}><span className="summary-key">{k}</span><span className="summary-val">{v}</span></div>
            ))}
          </div>
          <div className="summary-box">
            <div className="summary-title">Strategy Cost Comparison</div>
            {[["Chase", hire * LABOR.hiringCost + fire * LABOR.firingCost + reqWorkers * LABOR.wagePerDay * LABOR.workdaysPerQ, "var(--amber)"], ["Level", curW * LABOR.wagePerDay * LABOR.workdaysPerQ, "var(--navy)"], ["Mixed", Math.ceil((curW+reqWorkers)/2) * LABOR.wagePerDay * LABOR.workdaysPerQ + Math.max(0,reqWorkers - Math.ceil((curW+reqWorkers)/2)) * LABOR.hiringCost, "var(--green)"]].map(([s, c, col]) => (
              <div key={s} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border1)" }}>
                <span style={{ fontSize: "0.85rem", color: strategy === s.toUpperCase() ? col : "var(--text3)", fontWeight: strategy === s.toUpperCase() ? 700 : 400 }}>{s}{strategy === s.toUpperCase() ? " ✓" : ""}</span>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.85rem", color: col }}>{fmt(c)}</span>
              </div>
            ))}
            <div className="theory-formula" style={{ marginTop: 12 }}>Chase Cost = Σ(Hires×₹15K) + Σ(Fires×₹20K) + Workers×₹800×65days</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InventoryPanel({ decisions, state, dispatch }) {
  const totalC = ZONES.reduce((acc, z) => acc + Object.values(state.installations[z.id] || {}).reduce((a, b) => a + b, 0), 0);
  const annualD = totalC * 200 * 4;
  const eoqE = calculateEOQ(annualD, INV.energy.orderCost, INV.energy.holdingRate * INV.energy.unitCost);
  const playerOrder = decisions.energyOrderKwh || eoqE;
  const holdCost = (playerOrder / 2) * INV.energy.holdingRate * INV.energy.unitCost;
  const orderCostQ = (annualD / (playerOrder || 1)) * INV.energy.orderCost / 4;
  const eoqHold = (eoqE / 2) * INV.energy.holdingRate * INV.energy.unitCost;
  const eoqOrder = (annualD / (eoqE || 1)) * INV.energy.orderCost / 4;

  return (
    <div className="decision-panel">
      <div className="decision-panel-header"><Package size={18} /><div className="decision-panel-title">Energy Storage & Spare Parts Inventory</div></div>
      <div className="decision-panel-body">
        <div className="section-header"><Zap size={16} color="var(--amber)" /> Energy Storage (Battery Banks)</div>
        <div className="input-grid">
          {[["Energy Order (kWh)", "energyOrderKwh", eoqE, 50, 5000], ["Safety Stock Target (kWh)", "energySafetyStock", Math.round(eoqE * 0.15), 0, 1000]].map(([l, k, def, mn, mx]) => (
            <div className="input-group" key={k}>
              <div className="input-label">{l}</div>
              <input type="number" className="num-input" value={decisions[k] || def} min={mn} max={mx}
                onChange={e => dispatch({ type: "UPDATE_DECISION", payload: { [k]: +e.target.value } })} />
            </div>
          ))}
          <div className="input-group">
            <div className="input-label">EOQ Recommendation</div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "1.1rem", fontWeight: 700, color: "var(--green)", paddingTop: 6 }}>{eoqE} kWh</div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.65rem", color: "var(--text3)" }}>√(2×{Math.round(annualD / 1000)}K×₹{INV.energy.orderCost / 1000}K/{Math.round(INV.energy.holdingRate * INV.energy.unitCost)})</div>
          </div>
        </div>
        <div className="eoq-comparison">
          <div className="eoq-box">
            <div className="eoq-box-label">Your Order Quantity</div>
            <div className="eoq-box-value">{playerOrder} kWh</div>
            <div className="eoq-box-cost">Total Cost/Q: {fmt(holdCost + orderCostQ)}</div>
            <div className="eoq-box-cost">Holding: {fmt(holdCost)} | Ordering: {fmt(orderCostQ)}</div>
          </div>
          <div className={`eoq-box ${Math.abs(playerOrder - eoqE) / eoqE < 0.1 ? "highlight" : ""}`}>
            <div className="eoq-box-label">EOQ Optimal</div>
            <div className="eoq-box-value">{eoqE} kWh</div>
            <div className="eoq-box-cost">Min Cost/Q: {fmt(eoqHold + eoqOrder)}</div>
            <div className="eoq-box-cost">Saving: {fmt(Math.max(0, (holdCost + orderCostQ) - (eoqHold + eoqOrder)))}</div>
          </div>
        </div>
        <div className="theory-formula" style={{ marginTop: 16 }}>EOQ = √(2DS/H) = √(2 × {Math.round(annualD)} × {INV.energy.orderCost} / {Math.round(INV.energy.holdingRate * INV.energy.unitCost)}) = {eoqE} kWh</div>
        
        <div className="section-break" />
        <div className="section-header"><Truck size={16} color="var(--navy)" /> Spare Parts</div>
        <div className="input-grid">
          <div className="input-group">
            <div className="input-label">Order Quantity (units)</div>
            <input type="number" className="num-input" value={decisions.sparePartsOrder || Math.ceil(totalC * 4)} min={0} max={500}
              onChange={e => dispatch({ type: "UPDATE_DECISION", payload: { sparePartsOrder: +e.target.value } })} />
          </div>
          <div className="input-group">
            <div className="input-label">Parts Needed This Quarter</div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "1.1rem", fontWeight: 700, color: "var(--navy)", paddingTop: 6 }}>{totalC * INV.parts.usagePerChargerQ}</div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.65rem", color: "var(--text3)" }}>{totalC} chargers × {INV.parts.usagePerChargerQ} parts/charger</div>
          </div>
          <div className="input-group">
            <div className="input-label">Current Stock</div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "1.1rem", fontWeight: 700, color: "var(--text1)", paddingTop: 6 }}>{state.inventory.spareParts || 500}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function QueuePanel({ decisions, state, dispatch }) {
  const queueData = ZONES.map(z => {
    const totalC = Object.entries((state.installations[z.id] || {})).reduce((acc, [t, c]) => acc + c, 0) + ["SLOW","FAST","ULTRA"].reduce((a,t) => a + (decisions.newInstall?.[z.id]?.[t]||0), 0);
    const mu = totalC > 0 ? Object.entries({ ...(state.installations[z.id]||{}), ...Object.fromEntries(["SLOW","FAST","ULTRA"].map(t => [t, (state.installations[z.id]?.[t]||0) + (decisions.newInstall?.[z.id]?.[t]||0)])) }).reduce((acc, [t, c]) => acc + (CHARGER_TYPES[t]?.serviceRate || 0) * c, 0) / totalC : 1;
    const lambda = BASE_DEMAND[z.id] * SEASONAL_FACTORS[state.round] / 18;
    const q = calculateMMcQueue(lambda, mu, Math.max(1, totalC));
    return { ...z, ...q, lambda: +lambda.toFixed(3), mu: +mu.toFixed(3), chargers: totalC };
  });

  return (
    <div className="decision-panel">
      <div className="decision-panel-header"><Users size={18} /><div className="decision-panel-title">Service Queue Configuration</div></div>
      <div className="decision-panel-body">
        <div className="input-grid" style={{ marginBottom: 16 }}>
          <div className="input-group">
            <div className="input-label">Max Queue Length (vehicles)</div>
            <input type="range" className="range-input" min={5} max={50} value={decisions.maxQueueLength || 20}
              onChange={e => dispatch({ type: "UPDATE_DECISION", payload: { maxQueueLength: +e.target.value } })} />
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.9rem", fontWeight: 700 }}>{decisions.maxQueueLength || 20} vehicles</div>
          </div>
          <div className="input-group">
            <div className="input-label">Priority Rule</div>
            <select className="select-input" value={decisions.priorityRule || "FCFS"} onChange={e => dispatch({ type: "UPDATE_DECISION", payload: { priorityRule: e.target.value } })}>
              <option value="FCFS">First Come First Served</option>
              <option value="FAST_PRIORITY">Priority: Fast Chargers</option>
            </select>
          </div>
          <div className="input-group">
            <div className="input-label">Energy Contract</div>
            <select className="select-input" value={decisions.energyContract || "GRID"} onChange={e => dispatch({ type: "UPDATE_DECISION", payload: { energyContract: e.target.value } })}>
              <option value="GRID">Grid Only (₹8.50/kWh)</option>
              <option value="HYBRID">Hybrid Solar (₹7.20/kWh)</option>
              <option value="SOLAR">Full Solar (₹6.10/kWh)</option>
            </select>
          </div>
        </div>
        <div className="section-subheader">Live M/M/c Queue Preview by Zone</div>
        <div className="queue-grid">
          {queueData.map(z => (
            <div key={z.id} className="queue-card" style={{ borderTop: `3px solid ${getWqColor(z.Wq)}` }}>
              <div className="queue-card-header">
                <div className="queue-zone-name">{z.name}</div>
                <span className={`tag ${z.serviceLevel >= 85 ? "tag-green" : z.serviceLevel >= 70 ? "tag-amber" : "tag-red"}`}>{z.serviceLevel}% SVC</span>
              </div>
              <div className="queue-param-grid">
                {[["λ (arr/hr)", z.lambda], ["μ (svc/hr)", z.mu], ["c (servers)", z.chargers], ["ρ (util)", z.rho], ["Lq (queue)", z.Lq + " veh"], ["Wq (wait)", z.Wq + " min"]].map(([l, v]) => (
                  <div className="queue-param" key={l}><div className="queue-param-label">{l}</div><div className="queue-param-value">{v}</div></div>
                ))}
              </div>
              <div className="queue-insight">
                {z.Wq < 10 ? `✓ Excellent! Avg wait ${z.Wq} min is below 10-min target.` : z.Wq < 20 ? `⚠ Wait ${z.Wq} min. Consider adding 1 charger to reduce ρ from ${z.rho}.` : `✗ Critical: ${z.Wq} min wait. ρ=${z.rho} is dangerously high. Add chargers immediately.`}
              </div>
            </div>
          ))}
        </div>
        <div className="theory-formula" style={{ marginTop: 16 }}>M/M/c: ρ = λ/(cμ) | Lq = P₀(λ/μ)^c×ρ / [c!(1-ρ)²] | Wq = Lq/λ</div>
      </div>
    </div>
  );
}

function PricingMaintenancePanel({ decisions, dispatch, round }) {
  return (
    <div className="decision-panel">
      <div className="decision-panel-header"><DollarSign size={18} /><div className="decision-panel-title">Pricing Strategy & Maintenance</div></div>
      <div className="decision-panel-body">
        <div className="section-header">Pricing by Charger Type</div>
        <div className="input-grid">
          {[["Slow AC Price (₹)", "priceSLOW", 80, 40, 200], ["Fast DC Price (₹)", "priceFAST", 250, 150, 600], ["Ultra-Fast Price (₹)", "priceULTRA", 500, 300, 1200]].map(([l, k, def, mn, mx]) => (
            <div className="input-group" key={k}>
              <div className="input-label">{l}</div>
              <input type="number" className="num-input" value={decisions[k] || def} min={mn} max={mx}
                onChange={e => dispatch({ type: "UPDATE_DECISION", payload: { [k]: +e.target.value } })} />
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.65rem", color: "var(--text3)", marginTop: 4 }}>Elasticity: -0.3 (±10% price → ∓3% demand)</div>
            </div>
          ))}
        </div>
        <div className="section-break" />
        <div className="section-header">Maintenance Strategy</div>
        <div className="strategy-grid" style={{ marginBottom: 12 }}>
          {[["PREVENTIVE", "Preventive", "1.2× cost, 5% downtime"], ["REACTIVE", "Reactive", "0.6× cost, 15% breakdown risk"], ...(round >= 4 ? [["PREDICTIVE", "Predictive IoT", "1.5× cost, 2% downtime"]] : [])].map(([v, n, d]) => (
            <div key={v} className={`strategy-card ${(decisions.maintenanceStrategy || "PREVENTIVE") === v ? "selected" : ""}`} onClick={() => dispatch({ type: "UPDATE_DECISION", payload: { maintenanceStrategy: v } })}>
              <div className="strategy-name">{n}</div><div className="strategy-sub">{d}</div>
            </div>
          ))}
        </div>
        <div className="theory-formula">Preventive: more upfront cost but higher effective capacity. Reactive: saves ₹ short-term, risks breakdowns. Downtime reduces effective capacity by availability factor.</div>
      </div>
    </div>
  );
}

function DecisionRound({ state, dispatch }) {
  const decisions = state.currentDecisions;
  const qInfo = QUARTER_INFO[state.round];
  const [showSummary, setShowSummary] = useState(false);

  const totalInstallCost = ZONES.reduce((acc, z) =>
    acc + ["SLOW","FAST","ULTRA"].reduce((a,t) => a + (decisions.newInstall?.[z.id]?.[t]||0) * CHARGER_TYPES[t].installCost, 0), 0);

  const totalChargers = ZONES.reduce((acc, z) =>
    acc + ["SLOW","FAST","ULTRA"].reduce((a,t) => a + (state.installations[z.id]?.[t]||0) + (decisions.newInstall?.[z.id]?.[t]||0), 0), 0);

  const estRevenue = totalChargers * 150 * 18 * 0.7 * 90;
  const estCost = totalInstallCost + totalChargers * 800 * 90 + state.workforce.currentWorkers * LABOR.wagePerDay * LABOR.workdaysPerQ + FIXED_COSTS_PER_QUARTER;

  const navItems = [
    { id: "capacity", label: "Capacity", icon: <Battery size={15} /> },
    { id: "planning", label: "Agg. Planning", icon: <Calendar size={15} /> },
    { id: "inventory", label: "Inventory", icon: <Package size={15} /> },
    { id: "queue", label: "Queue Policy", icon: <Users size={15} /> },
    { id: "pricing", label: "Pricing & Maint.", icon: <DollarSign size={15} /> }
  ];

  const panelMap = {
    capacity: <CapacityPanel decisions={decisions} installations={state.installations} dispatch={dispatch} capital={state.capital} />,
    planning: <AggregatePlanningPanel decisions={decisions} state={state} dispatch={dispatch} />,
    inventory: <InventoryPanel decisions={decisions} state={state} dispatch={dispatch} />,
    queue: <QueuePanel decisions={decisions} state={state} dispatch={dispatch} />,
    pricing: <PricingMaintenancePanel decisions={decisions} dispatch={dispatch} round={state.round} />
  };

  return (
    <div className="main-content">
      {/* Context Banner */}
      <div className="context-banner">
        <div className="context-quarter">{qInfo.label}</div>
        <div className="context-info">
          <div className="context-period">{qInfo.period}</div>
          <div className="context-season">{qInfo.season}</div>
          <div className="context-desc">{qInfo.desc}</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.65rem", color: "var(--text3)", textTransform: "uppercase", marginBottom: 4 }}>Available Capital</div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "1.3rem", fontWeight: 700, color: state.capital > 0 ? "var(--green)" : "var(--red)" }}>{fmt(state.capital)}</div>
        </div>
      </div>

      {/* Demand Forecast */}
      <div style={{ marginBottom: 20 }}>
        <div className="page-sub">Demand Forecast — {qInfo.label}</div>
        <div className="forecast-row">
          {ZONES.map(z => {
            const forecast = Math.round(BASE_DEMAND[z.id] * SEASONAL_FACTORS[state.round] * Math.pow(1.08, state.round - 1));
            return (
              <div className="forecast-card" key={z.id}>
                <div className="forecast-zone">{z.name.split(" ")[0]}</div>
                <div className="forecast-val">{forecast}</div>
                <div className="forecast-unit">EVs/day</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Decision Layout */}
      <div className="decision-layout">
        <div className="decision-nav">
          {navItems.map(n => (
            <div key={n.id} className={`decision-nav-item ${state.activeDecisionTab === n.id ? "active" : ""}`}
              onClick={() => dispatch({ type: "SET_DECISION_TAB", payload: n.id })}>
              {n.icon} {n.label}
            </div>
          ))}
          <div style={{ marginTop: 16 }}>
            <div className="summary-box">
              <div className="summary-title">Round Preview</div>
              {[["Est. Revenue", fmt(estRevenue)], ["Est. Cost", fmt(estCost)], ["Install Cost", fmt(totalInstallCost)], ["Capital Left", fmt(state.capital - totalInstallCost)]].map(([k, v]) => (
                <div className="summary-row" key={k}><span className="summary-key">{k}</span><span className="summary-val" style={{ color: k === "Capital Left" && (state.capital - totalInstallCost) < 0 ? "var(--red)" : undefined }}>{v}</span></div>
              ))}
            </div>
          </div>
        </div>
        <div className="decision-main">{panelMap[state.activeDecisionTab] || panelMap.capacity}</div>
      </div>

      {/* Submit */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 20, paddingTop: 20, borderTop: "2px solid var(--border1)" }}>
        <button className="btn-secondary" onClick={() => setShowSummary(true)}>Review Decisions</button>
        <button className="btn-green" disabled={totalInstallCost > state.capital} onClick={() => dispatch({ type: "SUBMIT_ROUND" })}>
          Submit Quarter {state.round} Decisions <ArrowRight size={16} />
        </button>
      </div>

      {/* Summary Modal */}
      {showSummary && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,20,40,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "white", borderRadius: 16, padding: 36, maxWidth: 600, width: "100%", maxHeight: "85vh", overflow: "auto" }}>
            <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: "1.4rem", color: "var(--navy)", marginBottom: 20, borderBottom: "2px solid var(--border1)", paddingBottom: 12 }}>
              Q{state.round} Decision Summary
            </div>
            {[
              ["Capacity Changes", `${totalChargers} total chargers | Install cost: ${fmt(totalInstallCost)}`],
              ["Workforce Strategy", `${decisions.apStrategy || "LEVEL"} | Current: ${state.workforce.currentWorkers} workers`],
              ["Energy Order", `${decisions.energyOrderKwh || 0} kWh | Contract: ${decisions.energyContract || "GRID"}`],
              ["Spare Parts", `${decisions.sparePartsOrder || 0} units ordered`],
              ["Pricing", `Slow: ₹${decisions.priceSLOW || 80} | Fast: ₹${decisions.priceFAST || 250} | Ultra: ₹${decisions.priceULTRA || 500}`],
              ["Maintenance", `${decisions.maintenanceStrategy || "PREVENTIVE"}`],
              ["Est. Net Profit", fmt(estRevenue - estCost)]
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border1)", fontSize: "0.9rem" }}>
                <span style={{ color: "var(--text3)", fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.75rem" }}>{k}</span>
                <span style={{ fontWeight: 600, color: "var(--text1)" }}>{v}</span>
              </div>
            ))}
            <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
              <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setShowSummary(false)}>← Edit Decisions</button>
              <button className="btn-green" style={{ flex: 1, justifyContent: "center" }} onClick={() => { setShowSummary(false); dispatch({ type: "SUBMIT_ROUND" }); }}>
                Confirm & Submit <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// LOADING SCREEN
// ============================================================

function LoadingScreen({ round }) {
  return (
    <div className="loading-screen">
      <div style={{ marginBottom: 24 }}><Zap size={40} color="var(--navy)" /></div>
      <div className="loading-title">Running Q{round} Simulation</div>
      <div className="loading-sub">Processing your decisions through the OM engine...</div>
      <div className="loading-bar-wrap"><div className="loading-bar" /></div>
      <div className="loading-steps">
        {["Calculating demand with seasonal factors...", "Running M/M/c queue analysis for all 5 zones...", "Simulating inventory over 65-day quarter...", "Computing workforce costs and AP trade-offs..."].map((s, i) => (
          <div key={i} className="loading-step"><CheckCircle size={14} color="var(--green)" />{s}</div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// DASHBOARD
// ============================================================

function Dashboard({ state, dispatch }) {
  const r = state.lastResult;
  if (!r) return null;

  const prevResult = state.history.length > 1 ? state.history[state.history.length - 2]?.result : null;
  const revTrend = prevResult ? ((r.totalRevenue - prevResult.totalRevenue) / prevResult.totalRevenue * 100) : null;
  const profitTrend = prevResult ? r.netProfit - prevResult.netProfit : null;

  const chartData = state.history.map(h => ({
    name: `Q${h.round}`,
    Revenue: Math.round(h.result.totalRevenue / 100000),
    Cost: Math.round(h.result.totalCost / 100000),
    Profit: Math.round(h.result.netProfit / 100000)
  }));

  const utilData = ZONES.map(z => ({
    zone: z.name.split(" ")[0],
    Utilization: r.utilizationByZone[z.id] || 0,
    ServiceLevel: r.queueByZone[z.id]?.serviceLevel || 0
  }));

  const tabs = [
    { id: "summary", label: "Summary", icon: <BarChart2 size={14} /> },
    { id: "queuing", label: "Queuing", icon: <Users size={14} /> },
    { id: "inventory", label: "Inventory", icon: <Package size={14} /> },
    { id: "financials", label: "Financials", icon: <DollarSign size={14} /> },
    { id: "planning", label: "AP Analysis", icon: <Calendar size={14} /> },
    { id: "theory", label: "Theory Insights", icon: <BookOpen size={14} /> }
  ];

  const kpis = [
    { label: "Quarterly Revenue", value: fmt(r.totalRevenue), trend: revTrend, color: "var(--navy)", sub: `${fmt(r.totalRevenue / Math.max(1, Object.values(r.sessionsByZone || {}).reduce((a,b)=>a+b,0)*90))}/session avg` },
    { label: "Avg Utilization", value: `${r.avgUtilization.toFixed(1)}%`, color: getUtilColor(r.avgUtilization), sub: r.avgUtilization >= 70 && r.avgUtilization <= 85 ? "✓ Optimal range" : r.avgUtilization > 85 ? "⚠ Overloaded" : "⚠ Underutilized" },
    { label: "Service Level", value: `${r.avgServiceLevel.toFixed(1)}%`, color: r.avgServiceLevel >= 85 ? "var(--green)" : r.avgServiceLevel >= 75 ? "var(--amber)" : "var(--red)", sub: `Avg wait: ${r.avgWaitTime.toFixed(1)} min` },
    { label: "Net Profit", value: fmt(r.netProfit), color: r.netProfit >= 0 ? "var(--green)" : "var(--red)", sub: `Cumulative: ${fmt(state.cumulativeProfit)}` }
  ];

  // Events
  const events = [];
  if (r.avgUtilization > 90) events.push({ type: "danger", title: "System Overload Alert", body: `Average utilization hit ${r.avgUtilization.toFixed(1)}% this quarter. Queue times exceeded targets in multiple zones.`, theory: "OM Link: Capacity Planning — as ρ→1, queue length Lq→∞ (M/M/c theory)" });
  if (r.stockoutEnergy + r.stockoutParts > 0) events.push({ type: "warning", title: "Inventory Stockout", body: `${r.stockoutEnergy + r.stockoutParts} unit shortage. Cost: ${fmt(r.stockoutCost)}. Safety stock was insufficient.`, theory: "OM Link: Inventory Management — ROP and Safety Stock below required level" });
  if (r.netProfit > 500000) events.push({ type: "success", title: "Excellent Quarter!", body: `Net profit of ${fmt(r.netProfit)} achieved. Cumulative position: ${fmt(state.cumulativeProfit)}.`, theory: "OM Link: All four concepts aligned for strong performance" });
  if (state.round === 4 && Math.random() > 0.6) events.push({ type: "info", title: "Festival Season Demand Surge", body: "+30% demand expected next quarter (Q4 festival season). Plan capacity and workforce accordingly.", theory: "OM Link: Aggregate Planning — anticipate seasonal demand peaks" });

  return (
    <div className="main-content">
      {/* Events */}
      {events.map((ev, i) => (
        <div key={i} className={`event-alert ${ev.type}`}>
          <div>{ev.type === "danger" ? <AlertTriangle size={20} color="var(--red)" /> : ev.type === "warning" ? <AlertCircle size={20} color="var(--amber)" /> : ev.type === "success" ? <CheckCircle size={20} color="var(--green)" /> : <Info size={20} color="var(--blue)" />}</div>
          <div style={{ flex: 1 }}>
            <div className="event-title">{ev.title}</div>
            <div className="event-body">{ev.body}</div>
            <div className="event-theory">{ev.theory}</div>
          </div>
        </div>
      ))}

      {/* KPI Row */}
      <div className="kpi-row">
        {kpis.map((k, i) => (
          <div className="kpi-card" key={i} style={{ borderLeftColor: k.color }}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value" style={{ color: k.color }}>{k.value}</div>
            {k.trend !== undefined && k.trend !== null && (
              <div className={`kpi-trend ${k.trend >= 0 ? "trend-up" : "trend-down"}`}>
                {k.trend >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                {Math.abs(k.trend).toFixed(1)}% vs last quarter
              </div>
            )}
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.7rem", color: "var(--text3)", marginTop: 2 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="dash-tabs">
        {tabs.map(t => <button key={t.id} className={`dash-tab ${state.activeDashTab === t.id ? "active" : ""}`} onClick={() => dispatch({ type: "SET_DASH_TAB", payload: t.id })}>{t.icon} {t.label}</button>)}
      </div>

      {state.activeDashTab === "summary" && (
        <div>
          <div className="chart-grid">
            <div className="chart-card">
              <div className="chart-title">Revenue & Cost Trend</div>
              <div className="chart-sub">₹ in Lakhs | Click bars to see breakdown</div>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="name" style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }} />
                  <YAxis style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }} />
                  <Tooltip formatter={(v, n) => [`₹${v}L`, n]} contentStyle={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.75rem" }} />
                  <Legend wrapperStyle={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.75rem" }} />
                  <Bar dataKey="Revenue" fill="#00A878" radius={[3,3,0,0]} />
                  <Bar dataKey="Cost" fill="#E8871E" radius={[3,3,0,0]} />
                  <Line type="monotone" dataKey="Profit" stroke="#0A4F8C" strokeWidth={2} dot={{ r: 4 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-card">
              <div className="chart-title">Zone Utilization & Service Level</div>
              <div className="chart-sub">Current Quarter | Target: 70–85% utilization, 85%+ service</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={utilData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="zone" style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }} />
                  <YAxis domain={[0, 100]} style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }} />
                  <Tooltip formatter={(v, n) => [`${v.toFixed(1)}%`, n]} contentStyle={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.75rem" }} />
                  <Legend wrapperStyle={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.75rem" }} />
                  <ReferenceLine y={85} stroke="#E8871E" strokeDasharray="4 4" label={{ value: "Target 85%", fontSize: 10, fill: "#E8871E" }} />
                  <Bar dataKey="Utilization" fill="#0A4F8C" radius={[3,3,0,0]} />
                  <Bar dataKey="ServiceLevel" fill="#00A878" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Zone Table */}
          <div style={{ marginBottom: 20 }}>
            <div className="page-sub">Zone Performance Details</div>
            <table className="zone-table">
              <thead>
                <tr><th>Zone</th><th>Chargers</th><th>Demand/Day</th><th>Utilization</th><th>Avg Wait</th><th>Service Level</th><th>Revenue</th><th>Status</th></tr>
              </thead>
              <tbody>
                {ZONES.map(z => {
                  const u = r.utilizationByZone[z.id] || 0;
                  const q = r.queueByZone[z.id] || {};
                  const good = u >= 65 && u <= 88 && q.serviceLevel >= 80;
                  const bad = u > 92 || q.serviceLevel < 70 || q.Wq > 25;
                  return (
                    <tr key={z.id}>
                      <td><strong>{z.name}</strong><div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.65rem", color: "var(--text3)" }}>{z.type}</div></td>
                      <td><span className="current-badge">{["SLOW","FAST","ULTRA"].reduce((a,t) => a + (r.installs[z.id]?.[t]||0),0)}</span></td>
                      <td style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{r.demandByZone[z.id]}</td>
                      <td>
                        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700, color: getUtilColor(u) }}>{u}%</span>
                        <div className="util-bar-wrap"><div className="util-bar" style={{ width: `${u}%`, background: getUtilColor(u) }} /></div>
                      </td>
                      <td style={{ fontFamily: "'IBM Plex Mono',monospace", color: getWqColor(q.Wq || 0) }}>{(q.Wq || 0).toFixed(1)} min</td>
                      <td style={{ fontFamily: "'IBM Plex Mono',monospace", color: (q.serviceLevel || 0) >= 85 ? "var(--green)" : "var(--red)" }}>{(q.serviceLevel || 0).toFixed(1)}%</td>
                      <td style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{fmt(r.revenueByZone[z.id] || 0)}</td>
                      <td><span className={`status-badge ${bad ? "status-bad" : good ? "status-good" : "status-warning"}`}>{bad ? "⚠ Critical" : good ? "✓ Optimal" : "• Watch"}</span></td>
                    </tr>
                  );
                })}
                <tr className="total-row">
                  <td><strong>TOTAL</strong></td>
                  <td><span className="current-badge">{ZONES.reduce((acc,z) => acc + ["SLOW","FAST","ULTRA"].reduce((a,t) => a+(r.installs[z.id]?.[t]||0),0),0)}</span></td>
                  <td style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{ZONES.reduce((a,z) => a+r.demandByZone[z.id],0)}</td>
                  <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700 }}>{r.avgUtilization.toFixed(1)}% avg</td>
                  <td style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{r.avgWaitTime.toFixed(1)} min</td>
                  <td style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{r.avgServiceLevel.toFixed(1)}%</td>
                  <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700 }}>{fmt(r.totalRevenue)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {state.activeDashTab === "queuing" && (
        <div>
          <div className="page-title">Queue Analysis — M/M/c Model</div>
          <div className="page-sub">All parameters derived from actual M/M/c queuing formulas</div>
          <div className="queue-grid">
            {ZONES.map(z => {
              const q = r.queueByZone[z.id] || {};
              return (
                <div key={z.id} className="queue-card" style={{ borderTop: `4px solid ${getWqColor(q.Wq || 0)}` }}>
                  <div className="queue-card-header">
                    <div>
                      <div className="queue-zone-name">{z.name}</div>
                      <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.65rem", color: "var(--text3)" }}>{z.type}</div>
                    </div>
                    <span className={`tag ${(q.serviceLevel||0) >= 85 ? "tag-green" : (q.serviceLevel||0) >= 70 ? "tag-amber" : "tag-red"}`}>{(q.serviceLevel||0)}% SVC</span>
                  </div>
                  <div className="queue-param-grid">
                    {[["λ (arrivals/hr)", q.lambda], ["μ (service/hr)", q.mu], ["c (servers)", q.chargers], ["ρ (utilization)", q.rho], ["P₀ (idle prob.)", q.P0], ["Pw (wait prob.)", `${q.Pw}%`], ["Lq (avg queue)", `${q.Lq} veh`], ["Wq (avg wait)", `${q.Wq} min`], ["L (in system)", q.L], ["W (total time)", `${q.W} min`]].map(([l, v]) => (
                      <div className="queue-param" key={l}><div className="queue-param-label">{l}</div><div className="queue-param-value">{v}</div></div>
                    ))}
                  </div>
                  <div className="queue-insight">
                    {q.Wq < 10 ? `✓ Excellent performance. ρ=${q.rho} is in healthy range. Queue rarely builds.` : q.Wq < 20 ? `⚠ Moderate queue. ρ=${q.rho}. Adding 1 charger would reduce Wq by ~${Math.round(q.Wq * 0.4)} min.` : `✗ Overloaded! ρ=${q.rho} → Lq=${q.Lq} vehicles waiting. Add 2+ chargers urgently. Each addition dramatically reduces Wq at this utilization level.`}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="theory-card" style={{ marginTop: 20 }}>
            <div className="theory-concept">📐 M/M/c Queue Theory Reference</div>
            <div className="theory-formula">ρ = λ/(cμ) | P₀ = 1/[Σₙ₌₀^(c-1)(λ/μ)ⁿ/n! + (λ/μ)^c/(c!(1-ρ))] | Lq = P₀(λ/μ)^c×ρ/[c!(1-ρ)²] | Wq = Lq/λ | Service Level P(wait≤15min) = 1 - C(c,ρ)×e^(-(cμ-λ)×0.25)</div>
          </div>
        </div>
      )}

      {state.activeDashTab === "inventory" && (
        <div>
          <div className="page-title">Inventory Performance</div>
          <div className="page-sub">EOQ analysis and stockout tracking</div>
          <div className="grid-2">
            <div className="chart-card">
              <div className="chart-title">Energy Storage — EOQ Analysis</div>
              <div className="section-break" />
              {[["Your Order Quantity", `${r.playerEnergyOrder} kWh`], ["EOQ Recommendation", `${r.eoqEnergy} kWh`], ["Deviation from EOQ", `${(r.inventoryDeviation * 100).toFixed(1)}%`], ["Holding Cost", fmt(r.holdingCostEnergy)], ["Ordering Cost", fmt(r.orderingCostEnergy)], ["Total Inventory Cost", fmt(r.holdingCostEnergy + r.orderingCostEnergy)], ["Stockout Events (Energy)", r.stockoutEnergy], ["Stockout Cost", fmt(r.stockoutCost)]].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border1)", fontSize: "0.85rem" }}>
                  <span style={{ color: "var(--text3)", fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.75rem" }}>{k}</span>
                  <span style={{ fontWeight: 600, color: k.includes("Stockout") && v > 0 ? "var(--red)" : "var(--text1)" }}>{v}</span>
                </div>
              ))}
              <div className="theory-formula" style={{ marginTop: 12 }}>EOQ = √(2DS/H) = √(2 × {Math.round(r.eoqEnergy * 4)} × {INV.energy.orderCost} / {Math.round(INV.energy.holdingRate * INV.energy.unitCost)}) = {r.eoqEnergy} kWh | Your order: {r.playerEnergyOrder} kWh</div>
            </div>
            <div className="chart-card">
              <div className="chart-title">Spare Parts Status</div>
              <div className="section-break" />
              {[["Parts Consumed", r.partsNeeded], ["Parts in Stock (end)", `${state.inventory.spareParts} units`], ["Stockout Events", r.stockoutParts], ["Parts Lead Time", `${INV.parts.leadTimeDays / 7} weeks`], ["Holding Rate", `${INV.parts.holdingRate * 100}% of unit cost/mo`]].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border1)", fontSize: "0.85rem" }}>
                  <span style={{ color: "var(--text3)", fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.75rem" }}>{k}</span>
                  <span style={{ fontWeight: 600, color: k.includes("Stockout") && v > 0 ? "var(--red)" : "var(--text1)" }}>{v}</span>
                </div>
              ))}
              <div style={{ marginTop: 16, background: r.stockoutParts > 0 ? "#FFF0EF" : "#E8FFF5", borderRadius: 8, padding: 12 }}>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.7rem", color: r.stockoutParts > 0 ? "var(--red)" : "var(--green)", textTransform: "uppercase" }}>
                  {r.stockoutParts > 0 ? "⚠ Stockout Risk — Increase Safety Stock" : "✓ No Stockouts — Inventory Policy Adequate"}
                </div>
              </div>
              <div className="theory-formula" style={{ marginTop: 12 }}>ROP = d̄×L + z×σd×√L | Safety Stock = z×σd×√L (z=1.65 for 95% service level)</div>
            </div>
          </div>
        </div>
      )}

      {state.activeDashTab === "financials" && (
        <div>
          <div className="page-title">Financial Breakdown</div>
          <div className="page-sub">Income Statement — Q{state.round}</div>
          <div className="income-statement">
            <div className="income-header">VoltGrid Pvt. Ltd. — Quarterly P&L Statement (Q{state.round})</div>
            <div className="income-body">
              <div className="income-section">
                <div className="income-section-title">Revenue</div>
                {ZONES.map(z => <div className="income-row sub" key={z.id}><span>{z.name}</span><span>{fmt(r.revenueByZone[z.id] || 0)}</span></div>)}
                <div className="income-row total"><span>TOTAL REVENUE</span><span className="col-green">{fmt(r.totalRevenue)}</span></div>
              </div>
              <div className="income-section">
                <div className="income-section-title">Operating Costs</div>
                {[["Labor (Workforce)", r.laborCost], ["Charger Operations", r.chargerOpCost], ["Energy Procurement", r.energyCost], ["Maintenance", r.maintenanceCost], ["Inventory (Holding + Ordering)", r.holdingCostEnergy + r.orderingCostEnergy], ["Charger Installation (one-time)", r.installCost], ["Stockout Costs", r.stockoutCost], ["Fixed Overhead (HQ+License+Lease)", FIXED_COSTS_PER_QUARTER]].map(([l, v]) => (
                  <div className="income-row sub" key={l}><span>{l}</span><span>{fmt(v)}</span></div>
                ))}
                <div className="income-row total"><span>TOTAL COST</span><span className="col-red">{fmt(r.totalCost)}</span></div>
              </div>
              <div className="income-row net"><span>NET PROFIT / (LOSS)</span><span className={r.netProfit >= 0 ? "col-green" : "col-red"}>{fmt(r.netProfit)} ({((r.netProfit / Math.max(1, r.totalRevenue)) * 100).toFixed(1)}% margin)</span></div>
              <div className="income-row" style={{ marginTop: 8 }}><span style={{ color: "var(--text3)", fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.75rem" }}>Cumulative Profit</span><span style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700, color: state.cumulativeProfit >= 0 ? "var(--green)" : "var(--red)" }}>{fmt(state.cumulativeProfit)}</span></div>
            </div>
          </div>
        </div>
      )}

      {state.activeDashTab === "planning" && (
        <div>
          <div className="page-title">Aggregate Planning Analysis</div>
          <div className="page-sub">Workforce strategy outcome — Q{state.round}</div>
          <div className="grid-2">
            <div className="chart-card">
              <div className="chart-title">This Quarter's AP Outcome</div>
              <div className="section-break" />
              {[["Strategy Used", state.lastResult?.apStrategy || state.currentDecisions.apStrategy || "LEVEL"], ["Previous Workers", state.history.length > 1 ? state.history[state.history.length-2]?.result?.targetWorkers || 10 : 10], ["Current Workers", r.targetWorkers], ["Hires", r.hire > 0 ? `+${r.hire} × ₹15,000 = ${fmt(r.hire * LABOR.hiringCost)}` : "None"], ["Fires", r.fire > 0 ? `-${r.fire} × ₹20,000 = ${fmt(r.fire * LABOR.firingCost)}` : "None"], ["Overtime Hours", r.overtime > 0 ? `${Math.round(r.overtime)} hrs @ ₹${LABOR.wagePerDay * LABOR.OTMultiplier}/day` : "None"], ["Undertime Hours", r.undertime > 0 ? `${Math.round(r.undertime)} idle hrs` : "None"], ["Total Labor Cost", fmt(r.laborCost)]].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border1)", fontSize: "0.85rem" }}>
                  <span style={{ color: "var(--text3)", fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.75rem" }}>{k}</span>
                  <span style={{ fontWeight: 600, color: "var(--text1)" }}>{v}</span>
                </div>
              ))}
            </div>
            <div className="chart-card">
              <div className="chart-title">Strategy Cost Comparison</div>
              <div className="section-break" />
              {[["Chase Cost (est)", fmt((Math.abs(r.hire + r.fire) * 17500) + r.targetWorkers * LABOR.wagePerDay * LABOR.workdaysPerQ)], ["Level Cost (est)", fmt(state.workforce.currentWorkers * LABOR.wagePerDay * LABOR.workdaysPerQ)], ["Mixed Cost (est)", fmt(Math.ceil((state.workforce.currentWorkers + r.targetWorkers) / 2) * LABOR.wagePerDay * LABOR.workdaysPerQ)], ["Your Actual Cost", fmt(r.laborCost)]].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border1)", fontSize: "0.85rem" }}>
                  <span style={{ color: "var(--text3)", fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.75rem" }}>{k}</span>
                  <span style={{ fontWeight: 600, color: "var(--text1)" }}>{v}</span>
                </div>
              ))}
              <div className="theory-formula" style={{ marginTop: 12 }}>Chase: variable HR costs | Level: fixed labor, overtime buffer | Mixed: partial adjustment + OT blend</div>
              <div className="theory-suggestion" style={{ marginTop: 12 }}>
                <Star size={14} color="var(--green)" />
                <span>Level strategy minimizes hire/fire costs but may create undertime during low-demand quarters. Chase matches demand perfectly but incurs recurring HR costs. Mixed strategy often optimal for moderate variability.</span>
              </div>
            </div>
          </div>
          <div className="theory-formula" style={{ marginTop: 16 }}>Total AP Cost = Σ(hₜ×₹15,000) + Σ(fₜ×₹20,000) + Workers×₹800×65 + OT×₹800×1.5 + Undertime×₹800×0.5</div>
        </div>
      )}

      {state.activeDashTab === "theory" && (
        <div>
          <div className="page-title">Theory Insights</div>
          <div className="page-sub">Your Q{state.round} decisions analyzed through OM theory</div>
          {r.feedback && r.feedback.length > 0 ? r.feedback.map((fb, i) => (
            <div key={i} className="theory-card" style={{ borderLeftColor: fb.color === "danger" ? "var(--red)" : fb.color === "warning" ? "var(--amber)" : fb.color === "info" ? "var(--blue)" : "var(--green)" }}>
              <div className="theory-concept">🎓 OM CONCEPT: {fb.concept}</div>
              <div className="theory-title">{fb.title}</div>
              <div className="theory-body">{fb.explanation}</div>
              <div className="theory-formula">📐 Formula: {fb.formula}</div>
              <div className="theory-suggestion"><CheckCircle size={14} color="var(--green)" /> <span>💡 {fb.suggestion}</span></div>
            </div>
          )) : (
            <div className="event-alert success">
              <CheckCircle size={20} color="var(--green)" />
              <div>
                <div className="event-title">Strong Performance This Quarter!</div>
                <div className="event-body">Your decisions were well-aligned with OM best practices. Utilization in optimal range, service levels on target, and inventory policy appropriate. Continue this approach.</div>
              </div>
            </div>
          )}
          <div className="theory-card" style={{ borderLeftColor: "var(--navy)", marginTop: 16 }}>
            <div className="theory-concept">📚 Quarter Score Breakdown</div>
            <div className="theory-title">Q{state.round} Score: {r.roundScore.total.toFixed(1)} / 100</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12, marginTop: 12 }}>
              {[["Operational (Util + SvcLevel)", r.roundScore.operational, 25], ["Financial (Profitability)", r.roundScore.financial, 25], ["Inventory (EOQ + Stockouts)", r.roundScore.inventory, 25], ["Planning (AP Strategy)", 25 - Math.max(0, 25 - r.roundScore.operational), 25]].map(([l, s, mx]) => (
                <div key={l} style={{ background: "var(--bg2)", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.65rem", color: "var(--text3)", textTransform: "uppercase", marginBottom: 4 }}>{l}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "1.2rem", fontWeight: 700, color: s / mx >= 0.8 ? "var(--green)" : s / mx >= 0.6 ? "var(--amber)" : "var(--red)" }}>{s.toFixed(1)}/{mx}</div>
                  <div className="util-bar-wrap" style={{ marginTop: 4 }}><div className="util-bar" style={{ width: `${(s / mx) * 100}%`, background: s / mx >= 0.8 ? "var(--green)" : s / mx >= 0.6 ? "var(--amber)" : "var(--red)" }} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Proceed Button */}
      <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 24, marginTop: 16, borderTop: "2px solid var(--border1)" }}>
        <button className="btn-green" onClick={() => dispatch({ type: "NEXT_QUARTER" })}>
          {state.round >= 6 ? "View Final Report & Grade" : state.round === 2 || state.round === 4 ? "Proceed to Mid-Term Review" : `Proceed to Q${state.round + 1}`} <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

// ============================================================
// MID-TERM REVIEW
// ============================================================

function ReviewReport({ state, dispatch }) {
  const recentRounds = state.history.slice(-2);
  const avgUtil = recentRounds.reduce((a, h) => a + h.result.avgUtilization, 0) / recentRounds.length;
  const avgSvc = recentRounds.reduce((a, h) => a + h.result.avgServiceLevel, 0) / recentRounds.length;
  const totalProfit = recentRounds.reduce((a, h) => a + h.result.netProfit, 0);
  const totalStockouts = recentRounds.reduce((a, h) => a + h.result.stockoutEnergy + h.result.stockoutParts, 0);
  const opScore = recentRounds.reduce((a, h) => a + h.result.roundScore.operational, 0) / recentRounds.length;
  const finScore = recentRounds.reduce((a, h) => a + h.result.roundScore.financial, 0) / recentRounds.length;
  const invScore = recentRounds.reduce((a, h) => a + h.result.roundScore.inventory, 0) / recentRounds.length;
  const totalScore = (opScore + finScore + invScore).toFixed(1);
  const g = getGrade(+totalScore);

  const nextPhase = state.round === 2 ? "Q3–Q4" : "Q5–Q6";
  const nextSeason = state.round === 2 ? "Monsoon (lower demand) then Festival Season (+30%)." : "Growth phase then final performance review.";

  return (
    <div className="review-wrap">
      <div className="review-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
          <div>
            <div className="review-title">Mid-Term Review</div>
            <div className="review-sub">{state.round === 2 ? "Q1–Q2 Summary" : "Q3–Q4 Summary"} | VoltGrid Operations</div>
          </div>
          <div style={{ textAlign: "center", background: g.color + "15", border: `3px solid ${g.color}`, borderRadius: 12, padding: "12px 24px" }}>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "2.5rem", fontWeight: 700, color: g.color }}>{g.grade}</div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.7rem", color: g.color }}>{g.label}</div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.75rem", color: "var(--text3)" }}>{totalScore}/75</div>
          </div>
        </div>

        {/* Scorecard */}
        <table className="scorecard-table" style={{ marginBottom: 24 }}>
          <thead><tr><th>Category</th><th>Score</th><th>Max</th><th>Status</th></tr></thead>
          <tbody>
            {[["Operational (Util + Service Level)", opScore.toFixed(1), 25, avgUtil >= 70 && avgSvc >= 85], ["Financial (Profitability)", finScore.toFixed(1), 25, totalProfit > 0], ["Inventory (EOQ + Zero Stockouts)", invScore.toFixed(1), 25, totalStockouts === 0]].map(([c, s, mx, ok]) => (
              <tr key={c}><td>{c}</td><td><strong>{s}</strong></td><td>{mx}</td><td><span className={`tag ${ok ? "tag-green" : "tag-amber"}`}>{ok ? "✓ Met" : "⚠ Improve"}</span></td></tr>
            ))}
            <tr className="total-row"><td><strong>TOTAL</strong></td><td><strong>{totalScore}</strong></td><td>75</td><td><span className={`tag tag-navy`}>{g.grade} — {g.label}</span></td></tr>
          </tbody>
        </table>

        {/* Strengths */}
        <div style={{ marginBottom: 20 }}>
          <div className="section-header">✅ Strengths</div>
          {avgUtil >= 70 && avgUtil <= 85 && <div className="strength">Charger utilization averaged {avgUtil.toFixed(1)}% — within the optimal 70–85% range.</div>}
          {avgSvc >= 85 && <div className="strength">Service level of {avgSvc.toFixed(1)}% exceeded the 85% target. Customers are being served efficiently.</div>}
          {totalStockouts === 0 && <div className="strength">Zero inventory stockouts — excellent supply chain management. Safety stock policy is working.</div>}
          {totalProfit > 0 && <div className="strength">Positive net profit of {fmt(totalProfit)} over this phase. Business is financially viable.</div>}
        </div>

        {/* Improvements */}
        <div style={{ marginBottom: 24 }}>
          <div className="section-header">⚠️ Areas for Improvement</div>
          {avgUtil > 88 && <div className="improvement">High utilization ({avgUtil.toFixed(1)}%) is causing queue buildup. Add 2–3 chargers at overloaded zones before next phase.</div>}
          {avgUtil < 55 && <div className="improvement">Low utilization ({avgUtil.toFixed(1)}%) means fixed costs are eroding profitability. Use marketing or pricing to attract more demand.</div>}
          {avgSvc < 80 && <div className="improvement">Service level ({avgSvc.toFixed(1)}%) below 85% target. M/M/c analysis suggests reducing ρ by adding capacity.</div>}
          {totalStockouts > 0 && <div className="improvement">Stockout events occurred. Increase safety stock: SS = z×σd×√L (use z=1.65 for 95% service level).</div>}
          {totalProfit < 0 && <div className="improvement">Net loss of {fmt(Math.abs(totalProfit))}. Review charger mix, pricing, and workforce strategy. Consider reducing fixed capacity.</div>}
          {[{ ok: avgUtil >= 55 && avgUtil <= 88 }, { ok: avgSvc >= 80 }, { ok: totalStockouts === 0 }, { ok: totalProfit > 0 }].every(x => x.ok) && <div className="strength" style={{ background: "#EBF5FF", borderLeftColor: "var(--navy)" }}>All key metrics are on track. Maintain your current strategies into the next phase.</div>}
        </div>

        {/* Upcoming */}
        <div style={{ background: "var(--bg2)", border: "1.5px solid var(--border1)", borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <div className="section-header">📋 Guidance for {nextPhase}</div>
          <p style={{ fontSize: "0.9rem", color: "var(--text2)", lineHeight: 1.7 }}>{nextSeason}</p>
          <div style={{ marginTop: 12 }}>
            {state.round === 2 ? [
              "Q3 (Monsoon): Demand drops 15%. Consider level strategy to avoid over-hiring.",
              "Q4 (Festivals): +30% demand surge. Pre-install chargers NOW — installation takes effect next quarter.",
              "Safety stock: Increase by 20% before Q3 monsoon maintenance challenges.",
              "Queue: Monitor HEC Colony — industrial demand is most volatile."
            ] : [
              "Q5–Q6: Final 6 months. Focus on profitability optimization and cost reduction.",
              "EOQ: Fine-tune your order quantities to minimize total inventory cost.",
              "Service level: Push for 90%+ in final quarters to maximize score.",
              "Cumulative profit target: Aim for positive cumulative P&L by Q6."
            ].map((tip, i) => (
              <div key={i} style={{ display: "flex", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border1)", fontSize: "0.85rem", color: "var(--text2)" }}>
                <span style={{ color: "var(--navy)", fontWeight: 700 }}>{i + 1}.</span> {tip}
              </div>
            ))}
          </div>
        </div>

        <button className="btn-green" style={{ width: "100%", justifyContent: "center" }} onClick={() => dispatch({ type: "FROM_REVIEW" })}>
          Continue to {nextPhase} <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

// ============================================================
// FINAL REPORT
// ============================================================

function FinalReport({ state }) {
  const { grade, label, color } = getGrade(state.totalScore);
  const avgUtil = state.history.reduce((a, h) => a + h.result.avgUtilization, 0) / state.history.length;
  const avgSvc = state.history.reduce((a, h) => a + h.result.avgServiceLevel, 0) / state.history.length;
  const totalStockouts = state.history.reduce((a, h) => a + h.result.stockoutEnergy + h.result.stockoutParts, 0);

  const chartData = state.history.map(h => ({
    name: `Q${h.round}`,
    Revenue: Math.round(h.result.totalRevenue / 100000),
    Cost: Math.round(h.result.totalCost / 100000),
    Profit: Math.round(h.result.netProfit / 100000)
  }));

  return (
    <div className="final-wrap">
      <div className="final-card">
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.7rem", color: "var(--text3)", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 8 }}>VoltGrid Operations Simulation — Final Report</div>
          <h1 style={{ fontFamily: "'DM Serif Display',serif", fontSize: "2rem", color: "var(--navy)", marginBottom: 4 }}>Simulation Complete</h1>
          <p style={{ color: "var(--text3)", fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.75rem" }}>6 Quarters | Ranchi EV Charging Network | {state.playerName}</p>
        </div>

        {/* Summary Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 28 }}>
          {[["Total Revenue", fmt(state.cumulativeRevenue), "var(--green)"], ["Total Cost", fmt(state.cumulativeCost), "var(--amber)"], ["Net Profit", fmt(state.cumulativeProfit), state.cumulativeProfit >= 0 ? "var(--green)" : "var(--red)"], ["Final Score", `${state.totalScore}/100`, color]].map(([l, v, c]) => (
            <div key={l} style={{ background: "white", border: `1px solid var(--border1)`, borderRadius: 10, padding: 16, textAlign: "center", borderTop: `4px solid ${c}` }}>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.65rem", color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{l}</div>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "1.2rem", fontWeight: 700, color: c }}>{v}</div>
            </div>
          ))}
        </div>

        {/* P&L Chart */}
        <div className="chart-card" style={{ marginBottom: 24 }}>
          <div className="chart-title">6-Quarter P&L Overview</div>
          <div className="chart-sub">Revenue, Cost, and Profit across all simulation quarters (₹ Lakhs)</div>
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="name" style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }} />
              <YAxis style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }} />
              <Tooltip formatter={(v, n) => [`₹${v}L`, n]} contentStyle={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.75rem" }} />
              <Legend wrapperStyle={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.75rem" }} />
              <Bar dataKey="Revenue" fill="#00A878" radius={[3,3,0,0]} />
              <Bar dataKey="Cost" fill="#E8871E" radius={[3,3,0,0]} />
              <Line type="monotone" dataKey="Profit" stroke="#0A4F8C" strokeWidth={2.5} dot={{ r: 5, fill: "#0A4F8C" }} />
              <ReferenceLine y={0} stroke="#D93025" strokeDasharray="4 4" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Performance Summary */}
        <table className="scorecard-table" style={{ marginBottom: 28 }}>
          <thead><tr><th>Quarter</th><th>Revenue</th><th>Net Profit</th><th>Util %</th><th>Service %</th><th>Stockouts</th><th>Score</th></tr></thead>
          <tbody>
            {state.history.map(h => (
              <tr key={h.round}>
                <td><strong>Q{h.round}</strong> — {QUARTER_INFO[h.round].season}</td>
                <td style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{fmt(h.result.totalRevenue)}</td>
                <td style={{ fontFamily: "'IBM Plex Mono',monospace", color: h.result.netProfit >= 0 ? "var(--green)" : "var(--red)" }}>{fmt(h.result.netProfit)}</td>
                <td style={{ fontFamily: "'IBM Plex Mono',monospace", color: getUtilColor(h.result.avgUtilization) }}>{h.result.avgUtilization.toFixed(1)}%</td>
                <td style={{ fontFamily: "'IBM Plex Mono',monospace", color: h.result.avgServiceLevel >= 85 ? "var(--green)" : "var(--red)" }}>{h.result.avgServiceLevel.toFixed(1)}%</td>
                <td style={{ color: h.result.stockoutEnergy + h.result.stockoutParts > 0 ? "var(--red)" : "var(--green)", fontFamily: "'IBM Plex Mono',monospace" }}>{h.result.stockoutEnergy + h.result.stockoutParts}</td>
                <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700 }}>{h.result.roundScore.total.toFixed(0)}/100</td>
              </tr>
            ))}
            <tr className="total-row">
              <td><strong>OVERALL</strong></td>
              <td style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{fmt(state.cumulativeRevenue)}</td>
              <td style={{ fontFamily: "'IBM Plex Mono',monospace", color: state.cumulativeProfit >= 0 ? "var(--green)" : "var(--red)" }}>{fmt(state.cumulativeProfit)}</td>
              <td style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{avgUtil.toFixed(1)}% avg</td>
              <td style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{avgSvc.toFixed(1)}% avg</td>
              <td style={{ fontFamily: "'IBM Plex Mono',monospace", color: totalStockouts > 0 ? "var(--red)" : "var(--green)" }}>{totalStockouts}</td>
              <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700, color: color }}>{state.totalScore}/100</td>
            </tr>
          </tbody>
        </table>

        {/* Certificate */}
        <div className="certificate">
          <div style={{ fontSize: "2.5rem", marginBottom: 8 }}>⚡</div>
          <div className="cert-title">VoltGrid Operations Management Simulation</div>
          <div className="cert-sub">Certificate of Completion</div>
          <div style={{ fontSize: "0.9rem", color: "var(--text3)", marginBottom: 16 }}>This certifies that</div>
          <div className="cert-name">{state.playerName || "Operations Manager"}</div>
          <div style={{ fontSize: "0.9rem", color: "var(--text3)", marginBottom: 8 }}>
            {state.institution ? `of ${state.institution}, ` : ""}successfully completed the 6-quarter VoltGrid EV Charging Network Simulation applying Aggregate Planning, Capacity Planning, Inventory Management (EOQ), and M/M/c Queuing Theory.
          </div>
          <div style={{ marginBottom: 8 }} />
          <div className="cert-grade" style={{ color }}>{grade}</div>
          <div className="cert-score">{state.totalScore} / 100 — {label}</div>
          <div className="cert-metrics">
            {[["Avg Utilization", `${avgUtil.toFixed(1)}%`], ["Service Level", `${avgSvc.toFixed(1)}%`], ["Net Profit", fmt(state.cumulativeProfit)], ["Stockouts", totalStockouts === 0 ? "✓ Zero" : totalStockouts]].map(([l, v]) => (
              <div key={l} className="cert-metric"><div className="cert-metric-label">{l}</div><div className="cert-metric-value" style={{ color }}>{v}</div></div>
            ))}
          </div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.7rem", color: "var(--text3)", marginTop: 16 }}>Ranchi, Jharkhand | Q6 2026 | VoltGrid Pvt. Ltd.</div>
        </div>

        {/* Learning Outcomes */}
        <div style={{ marginTop: 32 }}>
          <div className="section-header">📚 Learning Outcomes Assessment</div>
          {[
            { concept: "Aggregate Planning", ok: state.history.some(h => h.decisions.apStrategy === "LEVEL" || h.decisions.apStrategy === "MIXED"), insight: "You applied " + (state.history.filter(h=>h.decisions.apStrategy==="CHASE").length > 3 ? "Chase strategy predominantly. Consider how Mixed strategy reduces HR costs in future simulations." : "Level/Mixed strategies effectively, balancing workforce stability with demand variability.") },
            { concept: "Capacity Planning", ok: avgUtil >= 60 && avgUtil <= 90, insight: `Average utilization of ${avgUtil.toFixed(1)}%. ${avgUtil >= 70 && avgUtil <= 85 ? "Optimal range achieved! You understood the trade-off between revenue maximization and queue prevention." : "Future focus: target 70–85% utilization to maximize revenue while keeping queues manageable."}` },
            { concept: "Inventory Management (EOQ)", ok: totalStockouts < 3, insight: totalStockouts === 0 ? "Zero stockouts throughout the simulation. Excellent application of safety stock and ROP principles." : `${totalStockouts} stockout events. Review EOQ formula and ensure safety stock = z×σd×√L covers demand variability during lead time.` },
            { concept: "Queuing Theory (M/M/c)", ok: avgSvc >= 80, insight: `Average service level of ${avgSvc.toFixed(1)}%. ${avgSvc >= 85 ? "Target met! You effectively used M/M/c analysis to balance server count with queue wait times." : "Review M/M/c model: Wq = Lq/λ. At high ρ, adding even 1 server dramatically reduces wait time. Target ρ < 0.85."}` }
          ].map((lo, i) => (
            <div key={i} style={{ background: lo.ok ? "#E8FFF5" : "#FFF7ED", borderLeft: `4px solid ${lo.ok ? "var(--green)" : "var(--amber)"}`, borderRadius: "0 8px 8px 0", padding: "14px 16px", marginBottom: 12 }}>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.7rem", color: lo.ok ? "var(--green)" : "var(--amber)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{lo.ok ? "✓" : "⚠"} {lo.concept}</div>
              <p style={{ fontSize: "0.9rem", color: "var(--text2)" }}>{lo.insight}</p>
            </div>
          ))}
        </div>

        <div style={{ textAlign: "center", marginTop: 32 }}>
          <button className="btn-primary" onClick={() => window.location.reload()}>Start New Simulation <RefreshCw size={16} /></button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SIMULATION SHELL
// ============================================================

function SimulationShell({ state, dispatch }) {
  const qInfo = QUARTER_INFO[state.round] || QUARTER_INFO[1];
  const g = getGrade(state.totalScore);

  if (state.phase === "RUNNING") return <LoadingScreen round={state.round} />;
  if (state.phase === "REVIEW") return <ReviewReport state={state} dispatch={dispatch} />;
  if (state.phase === "FINAL") return <FinalReport state={state} />;

  const dashNavItems = [
    { id: "summary", label: "Summary", icon: <BarChart2 size={15} /> },
    { id: "queuing", label: "Queuing", icon: <Users size={15} /> },
    { id: "inventory", label: "Inventory", icon: <Package size={15} /> },
    { id: "financials", label: "Financials", icon: <DollarSign size={15} /> },
    { id: "planning", label: "AP Analysis", icon: <Calendar size={15} /> },
    { id: "theory", label: "Theory", icon: <BookOpen size={15} /> }
  ];
  const decNavItems = [
    { id: "capacity", label: "Capacity", icon: <Battery size={15} /> },
    { id: "planning", label: "Agg. Planning", icon: <Calendar size={15} /> },
    { id: "inventory", label: "Inventory", icon: <Package size={15} /> },
    { id: "queue", label: "Queue Policy", icon: <Users size={15} /> },
    { id: "pricing", label: "Pricing & Maint.", icon: <DollarSign size={15} /> }
  ];

  const isDecision = state.phase === "DECISION";
  const navItems = isDecision ? decNavItems : dashNavItems;
  const activeItem = isDecision ? state.activeDecisionTab : state.activeDashTab;
  const setActiveItem = isDecision
    ? (id) => dispatch({ type: "SET_DECISION_TAB", payload: id })
    : (id) => dispatch({ type: "SET_DASH_TAB", payload: id });

  return (
    <div className="sim-shell">
      {/* Topbar */}
      <div className="topbar">
        <div className="topbar-brand"><Zap size={22} color="#00A878" /> VoltGrid</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {[1,2,3,4,5,6].map(q => (
            <div key={q} style={{ width: 28, height: 28, borderRadius: "50%", background: q < state.round ? "var(--green)" : q === state.round ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.7rem", fontWeight: 700, color: q === state.round ? "var(--navy)" : q < state.round ? "white" : "rgba(255,255,255,0.6)", border: q === state.round ? "2px solid white" : "none" }}>
              {q < state.round ? "✓" : q}
            </div>
          ))}
        </div>
        <div className="topbar-info">
          <div className="topbar-item"><div className="topbar-item-label">Capital</div><div className="topbar-item-value" style={{ color: state.capital > 1000000 ? "white" : state.capital > 0 ? "#FBD38D" : "#FC8181" }}>{fmt(state.capital)}</div></div>
          <div className="topbar-item"><div className="topbar-item-label">Quarter</div><div className="topbar-item-value">{qInfo.label}</div></div>
          <div className="topbar-item"><div className="topbar-item-label">Player</div><div className="topbar-item-value">{state.playerName.split(" ")[0]}</div></div>
        </div>
      </div>

      <div className="sim-body">
        {/* Sidebar */}
        <div className="sidebar">
          <div className="sidebar-section">
            <div className="sidebar-label">{isDecision ? "Decisions" : "Dashboard"}</div>
            {navItems.map(n => (
              <div key={n.id} className={`sidebar-item ${activeItem === n.id ? "active" : ""}`} onClick={() => setActiveItem(n.id)}>
                {n.icon} {n.label}
              </div>
            ))}
          </div>
          <div className="sidebar-section">
            <div className="sidebar-label">History</div>
            {state.history.slice(-4).map(h => (
              <div key={h.round} style={{ padding: "6px 10px", fontSize: "0.78rem", color: "var(--text3)", fontFamily: "'IBM Plex Mono',monospace", display: "flex", justifyContent: "space-between" }}>
                <span>Q{h.round}</span>
                <span style={{ color: h.result.netProfit >= 0 ? "var(--green)" : "var(--red)" }}>{fmt(h.result.netProfit)}</span>
              </div>
            ))}
          </div>
          <div className="sidebar-score">
            <div className="sidebar-score-label">Score</div>
            <div className="sidebar-score-value" style={{ color: g.color }}>{state.totalScore}</div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "0.7rem", color: g.color, marginTop: 2 }}>Grade {g.grade}</div>
            <div className="util-bar-wrap" style={{ marginTop: 6 }}><div className="util-bar" style={{ width: `${state.totalScore}%`, background: g.color }} /></div>
          </div>
        </div>

        {/* Main Content */}
        {state.phase === "DECISION" && <DecisionRound state={state} dispatch={dispatch} />}
        {state.phase === "DASHBOARD" && <Dashboard state={state} dispatch={dispatch} />}
      </div>
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Inject styles
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = styles;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  // Auto-advance from RUNNING state
  useEffect(() => {
    if (state.phase === "RUNNING") {
      const timer = setTimeout(() => dispatch({ type: "SET_PHASE", payload: "DASHBOARD" }), 2500);
      return () => clearTimeout(timer);
    }
  }, [state.phase]);

  const handleStart = ({ playerName, institution, difficulty }) => {
    dispatch({ type: "SET_PLAYER", playerName, institution, difficulty });
  };

  if (state.phase === "LANDING") return <LandingPage onStart={handleStart} />;
  if (state.phase === "BRIEFING") return <BriefingModule state={state} dispatch={dispatch} />;
  return <SimulationShell state={state} dispatch={dispatch} />;
}
