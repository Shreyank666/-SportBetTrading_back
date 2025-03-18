/**
 * Utility functions to transform data from the APIs
 */

/**
 * Transform sport data from the main sport API
 * @param {Object} data - API response data
 * @param {String} sportName - Sport name (cricket, football, tennis)
 */
const transformSportData = (data, sportName) => {
  if (!data || !data.result) {
    return { 
      success: false, 
      message: 'Invalid data format',
      sport: sportName
    };
  }

  try {
    // Convert array of markets/events into matches structure
    const matches = {};
    const competitions = {};
    
    // Process each market to group them by event/match
    data.result.forEach(market => {
      if (!market.event || !market.event.id) return;
      
      const eventId = market.event.id;
      const competitionId = market.competition?.id;
      const competitionName = market.competition?.name;
      
      // Store competition info
      if (competitionId && competitionName) {
        if (!competitions[competitionId]) {
          competitions[competitionId] = {
            id: competitionId,
            name: competitionName,
            matches: []
          };
        }
      }
      
      // Create or update match entry
      if (!matches[eventId]) {
        matches[eventId] = {
          id: eventId,
          name: market.event.name,
          venue: market.event.venue,
          startTime: market.event.openDate ? new Date(market.event.openDate).getTime() : market.start,
          inPlay: market.inPlay || false,
          sport: sportName,
          competitionId: competitionId,
          competition: competitionName,
          markets: []
        };
        
        // Add this match to its competition
        if (competitionId && competitions[competitionId]) {
          competitions[competitionId].matches.push(eventId);
        }
      }
      
      // Add market to match
      const transformedMarket = transformMarket(market);
      if (transformedMarket) {
        matches[eventId].markets.push(transformedMarket);
      }
    });
    
    // Convert competitions to array
    const competitionsArray = Object.values(competitions).map(comp => {
      return {
        ...comp,
        matches: comp.matches.map(matchId => matches[matchId])
      };
    });
    
    // Sort competitions by name
    competitionsArray.sort((a, b) => a.name.localeCompare(b.name));
    
    return {
      success: true,
      sport: sportName,
      competitions: competitionsArray,
      matchCount: Object.keys(matches).length,
      timestamp: new Date().getTime()
    };
  } catch (error) {
    console.error('Error transforming sport data:', error);
    return { 
      success: false, 
      message: `Error transforming ${sportName} data: ${error.message}`,
      sport: sportName
    };
  }
};

/**
 * Transform event data from the event API
 * @param {Object} data - API response data
 * @param {String} sportName - Sport name
 */
const transformEventData = (data, sportName) => {
  if (!data || !data.result) {
    return { 
      success: false, 
      message: 'Invalid event data format',
      sport: sportName
    };
  }

  try {
    // Get event details from the first market
    const firstMarket = data.result?.[0] || {};
    const event = firstMarket.event || {};
    
    // Get all markets and transform them
    const markets = data.result.map(market => transformMarket(market)).filter(Boolean);
    
    // Group markets by type for easier access in frontend
    const groupedMarkets = {
      matchOdds: markets.find(m => m.name === 'Match Odds'),
      tiedMatch: markets.find(m => m.name === 'Tied Match'),
      overUnderMarkets: markets.filter(m => m.name?.includes('Over/Under')),
      setMarkets: markets.filter(m => m.name?.includes('Set')),
      gameMarkets: markets.filter(m => m.name?.includes('Game')),
      otherMarkets: markets.filter(m => 
        m.name !== 'Match Odds' && 
        m.name !== 'Tied Match' && 
        !m.name?.includes('Over/Under') && 
        !m.name?.includes('Set') && 
        !m.name?.includes('Game')
      )
    };
    
    return {
      success: true,
      sport: sportName,
      event: {
        id: event.id,
        name: event.name,
        venue: event.venue,
        startTime: event.openDate ? new Date(event.openDate).getTime() : firstMarket.start,
        inPlay: firstMarket.inPlay || false,
        competition: firstMarket.competition?.name,
        competitionId: firstMarket.competition?.id
      },
      markets: markets,
      groupedMarkets: groupedMarkets,
      timestamp: new Date().getTime()
    };
  } catch (error) {
    console.error('Error transforming event data:', error);
    return { 
      success: false, 
      message: `Error transforming event data: ${error.message}`,
      sport: sportName
    };
  }
};

/**
 * Transform a market object
 * @param {Object} market - Market data from API
 */
const transformMarket = (market) => {
  if (!market || !market.runners) {
    return null;
  }

  try {
    return {
      id: market.id,
      name: market.name,
      status: market.status,
      inPlay: market.inPlay || false,
      totalMatched: market.matched,
      numWinners: market.numWinners,
      start: market.start,
      marketType: market.mtype,
      sport: market.eventTypeId === '1' ? 'football' : 
             market.eventTypeId === '2' ? 'tennis' : 
             market.eventTypeId === '4' ? 'cricket' : 'unknown',
      runners: market.runners.map(runner => ({
        id: runner.id,
        name: runner.name,
        status: runner.status,
        sortPriority: runner.sort,
        handicap: runner.hdp,
        lastPriceTraded: runner.lastPriceTraded,
        totalMatched: runner.totalMatched,
        backPrices: runner.back?.map(price => ({
          price: price.price,
          size: price.size
        })) || [],
        layPrices: runner.lay?.map(price => ({
          price: price.price,
          size: price.size
        })) || []
      }))
    };
  } catch (error) {
    console.error('Error transforming market:', error);
    return null;
  }
};

// Export all functions
module.exports = {
  transformSportData,
  transformEventData,
  transformMarket
}; 