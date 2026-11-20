import { NRW_MUSHROOM_SPECIES, SPECIES_BY_ID } from '../data/species';
import type {
  AspectDirection,
  DailyWeatherPoint,
  EcologicalFactorBreakdown,
  MushroomSpecies,
  NRWForestStand,
  ProbabilityTier,
  StandPrediction,
  SubRegionId,
  SubRegionWeatherSeries,
  WeatherMode,
} from '../types/foraging';

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

function gaussian(value: number, mean: number, sigma: number): number {
  const z = (value - mean) / sigma;
  return Math.exp(-0.5 * z * z);
}

const ASPECT_MOISTURE_FACTOR: Record<AspectDirection, number> = {
  N: 1.0,
  NE: 0.96,
  NW: 0.92,
  E: 0.86,
  Flat: 0.82,
  W: 0.78,
  SE: 0.74,
  SW: 0.68,
  S: 0.64,
};

/**
 * Exponentially weighted antecedent rainfall memory across days t-21..t-3.
 * Peak mycological fruiting response occurs ~10-15 days after soaking rainfall.
 */
export function computeWeightedRainLag(days: DailyWeatherPoint[], targetIdx: number): number {
  let weightedSum = 0;
  let weightTotal = 0;
  for (let lag = 2; lag <= 20; lag++) {
    const idx = targetIdx - lag;
    if (idx < 0 || idx >= days.length) continue;
    // Bell-shaped biological lag kernel peaking around 11 days before fruiting
    const w = Math.exp(-0.5 * Math.pow((lag - 11) / 5.2, 2));
    weightedSum += days[idx].precipitationMm * w;
    weightTotal += w;
  }
  if (weightTotal === 0) return 0;
  // Scale to an intuitive 14-day effective rainfall equivalent (mm)
  return (weightedSum / weightTotal) * 14;
}

/**
 * Evaluates static habitat suitability S_habitat(species, stand) in [0..1].
 */
export function computeHabitatSuitability(
  species: MushroomSpecies,
  stand: NRWForestStand
): {
  total: number;
  hostScore: number;
  soilPhScore: number;
  microclimateScore: number;
} {
  // 1. Obligate mycorrhizal host compatibility (weighted sum + peak host boost)
  let weightedHost = 0;
  let bestSingleHost = 0;
  for (const [hostKey, standShare] of Object.entries(stand.hostComposition)) {
    const share = standShare ?? 0;
    const affinity = species.hostAffinities[hostKey as keyof typeof species.hostAffinities] ?? 0;
    weightedHost += share * affinity;
    if (share >= 0.15 && affinity > bestSingleHost) {
      bestSingleHost = affinity * Math.min(1, share * 2.6);
    }
  }
  const hostScore = clamp(weightedHost * 0.65 + bestSingleHost * 0.45);

  // 2. Soil pH Gaussian fit + substrate texture bonus
  const phGaussian = gaussian(stand.soilPh, species.optimalPh, species.phTolerance);
  const textureBonus = species.preferredTextures.includes(stand.soilTexture) ? 1.0 : 0.76;
  const soilPhScore = clamp(phGaussian * textureBonus);

  // 3. Topography: elevation window, moisture-retaining aspect, slope, Siepen humidity
  const [minElev, maxElev] = species.elevationWindow;
  let elevFit = 1.0;
  if (stand.elevationM < minElev) {
    elevFit = clamp(1 - (minElev - stand.elevationM) / 220, 0.35, 1);
  } else if (stand.elevationM > maxElev) {
    elevFit = clamp(1 - (stand.elevationM - maxElev) / 250, 0.3, 1);
  }
  const aspectFit = ASPECT_MOISTURE_FACTOR[stand.aspect] ?? 0.8;
  const slopeFit = stand.slopeDeg <= 24 ? 1.0 : clamp(1 - (stand.slopeDeg - 24) / 20, 0.45, 1);
  const microclimateScore = clamp(
    elevFit * 0.45 + aspectFit * 0.25 + stand.valleyHumidityBonus * 0.2 + slopeFit * 0.1
  );

  // Obligate host acts as a strong multiplicative gate (no host -> negligible suitability)
  const total = clamp(
    Math.pow(hostScore, 0.85) * (0.45 + 0.55 * (soilPhScore * 0.65 + microclimateScore * 0.35))
  );

  return { total, hostScore, soilPhScore, microclimateScore };
}

/**
 * Evaluates dynamic weather-driven fruiting trigger F_fruiting(species, weather, t) in [0..1].
 */
export function computeDynamicFruiting(
  species: MushroomSpecies,
  series: SubRegionWeatherSeries,
  dayOffset: number,
  stand: NRWForestStand,
  weatherMode: WeatherMode
): {
  total: number;
  rainLagScore: number;
  soilMoistureScore: number;
  soilTempScore: number;
  seasonScore: number;
  weightedRainLagMm: number;
  soilMoisture3to9: number;
  soilTemp6cmC: number;
  minAirTempC: number;
  thermalShockBonus: boolean;
  frostBlocked: boolean;
} {
  const targetIdx = Math.min(series.days.length - 1, Math.max(0, series.todayIndex + dayOffset));
  const today = series.days[targetIdx];

  // Elevation adiabatic lapse adjustment (~0.6°C per 100m relative to sub-region reference ~260m)
  const elevDelta100m = (stand.elevationM - 260) / 100;
  const adjustedSoilTemp = today.soilTemp6cmC - elevDelta100m * 0.45;
  const adjustedMinAir = today.minAirTempC - elevDelta100m * 0.55;

  // Microclimate moisture boost on shaded north slopes & Siepen valleys
  const aspectFactor = ASPECT_MOISTURE_FACTOR[stand.aspect] ?? 0.8;
  const localMoisture = clamp(
    today.soilMoisture3to9 * 0.72 +
      today.soilMoisture9to27 * 0.28 +
      (stand.valleyHumidityBonus - 0.6) * 0.04 +
      (aspectFactor - 0.8) * 0.03,
    0.08,
    0.48
  );

  // 1. Lagged rainfall curve (asymmetric: drought hurts sharply, moderate excess is gentle)
  const weightedRainLagMm = computeWeightedRainLag(series.days, targetIdx);
  const rainRatio = weightedRainLagMm / species.optimalRainLagMm;
  const rainLagScore =
    rainRatio < 1
      ? clamp(Math.pow(rainRatio, 1.35))
      : clamp(1 - Math.max(0, rainRatio - 1.6) * 0.22, 0.65, 1);

  // 2. Root-zone soil moisture curve
  const soilMoistureScore = clamp(
    gaussian(localMoisture, species.optimalSoilMoisture, 0.11) *
      (localMoisture < 0.16 ? localMoisture / 0.16 : 1)
  );

  // 3. Soil temperature + autumn thermal shock trigger + frost cutoff
  const frostBlocked = adjustedMinAir <= -1.5 || adjustedSoilTemp <= 2.0;
  const prevIdx = Math.max(0, targetIdx - 5);
  const tempDrop = series.days[prevIdx].soilTemp6cmC - today.soilTemp6cmC;
  const thermalShockBonus = !frostBlocked && tempDrop >= 2.0 && tempDrop <= 6.5 && adjustedSoilTemp >= 7;

  let soilTempScore = gaussian(adjustedSoilTemp, species.optimalSoilTempC, species.soilTempTolerance);
  if (thermalShockBonus) {
    soilTempScore = clamp(soilTempScore * 1.12);
  }
  if (frostBlocked) {
    soilTempScore = Math.min(soilTempScore, 0.08);
  }

  // 4. Phenological season curve
  const monthIdx =
    weatherMode === 'peak-autumn' ? 9 : new Date(`${today.date}T12:00:00`).getMonth();
  const seasonScore = species.monthlySeasonality[monthIdx] ?? 0;

  // Combine dynamic triggers
  const hydroScore = rainLagScore * 0.52 + soilMoistureScore * 0.48;
  const rawTrigger = hydroScore * 0.55 + soilTempScore * 0.45;
  const total = frostBlocked
    ? clamp(rawTrigger * seasonScore * 0.15)
    : clamp(rawTrigger * (0.18 + 0.82 * seasonScore) * (seasonScore === 0 ? 0 : 1));

  return {
    total,
    rainLagScore,
    soilMoistureScore,
    soilTempScore,
    seasonScore,
    weightedRainLagMm,
    soilMoisture3to9: localMoisture,
    soilTemp6cmC: adjustedSoilTemp,
    minAirTempC: adjustedMinAir,
    thermalShockBonus,
    frostBlocked,
  };
}

export function classifyTier(probability: number, isNSG: boolean): ProbabilityTier {
  if (isNSG) return 'nsg';
  if (probability >= 80) return 'peak';
  if (probability >= 64) return 'high';
  if (probability >= 45) return 'moderate';
  if (probability >= 22) return 'low';
  return 'dormant';
}

export function getTierMeta(tier: ProbabilityTier): {
  label: string;
  fillColor: string;
  strokeColor: string;
  fillOpacity: number;
  textColor: string;
} {
  switch (tier) {
    case 'nsg':
      return {
        label: 'NSG · Picking Prohibited',
        fillColor: '#B91C1C',
        strokeColor: '#991B1B',
        fillOpacity: 0.22,
        textColor: '#991B1B',
      };
    case 'peak':
      return {
        label: 'Peak Flush (80%+)',
        fillColor: '#065F46',
        strokeColor: '#043F2E',
        fillOpacity: 0.52,
        textColor: '#065F46',
      };
    case 'high':
      return {
        label: 'High Probability (64–79%)',
        fillColor: '#15803D',
        strokeColor: '#14532D',
        fillOpacity: 0.40,
        textColor: '#15803D',
      };
    case 'moderate':
      return {
        label: 'Moderate (45–63%)',
        fillColor: '#D97706',
        strokeColor: '#92400E',
        fillOpacity: 0.34,
        textColor: '#B45309',
      };
    case 'low':
      return {
        label: 'Low (22–44%)',
        fillColor: '#C49A52',
        strokeColor: '#8A692C',
        fillOpacity: 0.24,
        textColor: '#785A21',
      };
    default:
      return {
        label: 'Dormant / Out of Season',
        fillColor: '#7A867E',
        strokeColor: '#525E56',
        fillOpacity: 0.16,
        textColor: '#4A5D52',
      };
  }
}

function buildDiagnosticText(
  species: MushroomSpecies,
  stand: NRWForestStand,
  habitat: ReturnType<typeof computeHabitatSuitability>,
  dynamic: ReturnType<typeof computeDynamicFruiting>
): { summaryReason: string; limitingFactor: string } {
  if (stand.isProtectedNSG) {
    return {
      summaryReason: `${stand.nsgName ?? 'Protected Naturschutzgebiet'} — foraging and leaving marked trails are illegal under NRW nature conservation law.`,
      limitingFactor: 'Legal NSG protection',
    };
  }

  if (dynamic.frostBlocked) {
    return {
      summaryReason: `Frost suppression (${dynamic.minAirTempC.toFixed(1)}°C air / ${dynamic.soilTemp6cmC.toFixed(1)}°C soil) halts active ${species.germanName} fruiting.`,
      limitingFactor: 'Sub-zero frost / cold soil',
    };
  }

  if (dynamic.seasonScore < 0.15) {
    return {
      summaryReason: `Outside normal German fruiting window for ${species.germanName} (${species.seasonLabel}).`,
      limitingFactor: 'Out of seasonal window',
    };
  }

  const scoredChecks: { key: string; score: number; limitMsg: string }[] = [
    {
      key: 'host',
      score: habitat.hostScore,
      limitMsg: `Weak host-tree match (prefers ${species.hostSummary})`,
    },
    {
      key: 'ph',
      score: habitat.soilPhScore,
      limitMsg: `Soil pH ${stand.soilPh.toFixed(1)} deviates from optimal pH ${species.optimalPh.toFixed(1)}`,
    },
    {
      key: 'rain',
      score: dynamic.rainLagScore,
      limitMsg: `Low 14-day effective rainfall (${dynamic.weightedRainLagMm.toFixed(0)} mm vs. ~${species.optimalRainLagMm} mm target)`,
    },
    {
      key: 'moisture',
      score: dynamic.soilMoistureScore,
      limitMsg: `Topsoil moisture (${(dynamic.soilMoisture3to9 * 100).toFixed(0)}%) below mycelial threshold`,
    },
    {
      key: 'temp',
      score: dynamic.soilTempScore,
      limitMsg: `6 cm soil temp (${dynamic.soilTemp6cmC.toFixed(1)}°C) outside ideal ${species.optimalSoilTempC.toFixed(0)}°C zone`,
    },
  ];
  scoredChecks.sort((a, b) => a.score - b.score);
  const weakest = scoredChecks[0];

  if (weakest.score >= 0.72) {
    const shockNote = dynamic.thermalShockBonus ? ' plus autumn cooling flush trigger' : '';
    return {
      summaryReason: `Strong ${species.hostSummary.toLowerCase()} stand on pH ${stand.soilPh.toFixed(1)} substrate with ${dynamic.weightedRainLagMm.toFixed(0)} mm rain lag${shockNote}.`,
      limitingFactor: 'All ecological conditions aligned',
    };
  }

  return {
    summaryReason: `${species.germanName} suitability moderated primarily by ${weakest.limitMsg.toLowerCase()}.`,
    limitingFactor: weakest.limitMsg,
  };
}

export function scoreStandForSpecies(
  stand: NRWForestStand,
  species: MushroomSpecies,
  series: SubRegionWeatherSeries,
  dayOffset: number,
  weatherMode: WeatherMode
): {
  probability: number;
  habitatSuitability: number;
  fruitingTrigger: number;
  factors: EcologicalFactorBreakdown;
  summaryReason: string;
  limitingFactor: string;
} {
  const habitat = computeHabitatSuitability(species, stand);
  const dynamic = computeDynamicFruiting(species, series, dayOffset, stand, weatherMode);

  // Combined probability scaled cleanly to 0..97%
  const rawProb = habitat.total * dynamic.total;
  const probability = stand.isProtectedNSG ? 0 : Math.round(clamp(rawProb * 1.12, 0, 0.97) * 100);

  const { summaryReason, limitingFactor } = buildDiagnosticText(species, stand, habitat, dynamic);

  return {
    probability,
    habitatSuitability: Math.round(habitat.total * 100),
    fruitingTrigger: Math.round(dynamic.total * 100),
    factors: {
      hostScore: Math.round(habitat.hostScore * 100),
      soilPhScore: Math.round(habitat.soilPhScore * 100),
      microclimateScore: Math.round(habitat.microclimateScore * 100),
      rainLagScore: Math.round(dynamic.rainLagScore * 100),
      soilMoistureScore: Math.round(dynamic.soilMoistureScore * 100),
      soilTempScore: Math.round(dynamic.soilTempScore * 100),
      seasonScore: Math.round(dynamic.seasonScore * 100),
      weightedRainLagMm: Number(dynamic.weightedRainLagMm.toFixed(1)),
      soilMoisture3to9: Number(dynamic.soilMoisture3to9.toFixed(3)),
      soilTemp6cmC: Number(dynamic.soilTemp6cmC.toFixed(1)),
      minAirTempC: Number(dynamic.minAirTempC.toFixed(1)),
      thermalShockBonus: dynamic.thermalShockBonus,
      frostBlocked: dynamic.frostBlocked,
    },
    summaryReason,
    limitingFactor,
  };
}

export function evaluateStand(
  stand: NRWForestStand,
  activeSpeciesId: string,
  weatherByRegion: Record<SubRegionId, SubRegionWeatherSeries>,
  dayOffset: number,
  weatherMode: WeatherMode
): StandPrediction {
  const series = weatherByRegion[stand.subRegion];
  const allScores = NRW_MUSHROOM_SPECIES.map((sp) => {
    const res = scoreStandForSpecies(stand, sp, series, dayOffset, weatherMode);
    return { species: sp, res };
  }).sort((a, b) => b.res.probability - a.res.probability);

  const speciesRanking = allScores.map((item) => ({
    speciesId: item.species.id,
    germanName: item.species.germanName,
    probability: item.res.probability,
  }));

  const targetEntry =
    activeSpeciesId === 'all'
      ? allScores[0]
      : allScores.find((x) => x.species.id === activeSpeciesId) ?? {
          species: SPECIES_BY_ID[activeSpeciesId] ?? NRW_MUSHROOM_SPECIES[0],
          res: scoreStandForSpecies(
            stand,
            SPECIES_BY_ID[activeSpeciesId] ?? NRW_MUSHROOM_SPECIES[0],
            series,
            dayOffset,
            weatherMode
          ),
        };

  const tier = classifyTier(targetEntry.res.probability, stand.isProtectedNSG);

  return {
    standId: stand.id,
    speciesId: activeSpeciesId,
    bestSpeciesId: targetEntry.species.id,
    bestSpeciesName: targetEntry.species.germanName,
    probability: targetEntry.res.probability,
    habitatSuitability: targetEntry.res.habitatSuitability,
    fruitingTrigger: targetEntry.res.fruitingTrigger,
    tier,
    isLegalBlocked: stand.isProtectedNSG,
    summaryReason: targetEntry.res.summaryReason,
    limitingFactor: targetEntry.res.limitingFactor,
    factors: targetEntry.res.factors,
    speciesRanking,
  };
}
