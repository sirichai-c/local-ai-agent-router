import { useEffect, useState } from 'react';

export function useSystemData(api) {
  const [state, setState] = useState({ loading: true, errors: [], health: null, ollama: null, models: null, agents: [] });
  useEffect(() => {
    let active = true;
    Promise.allSettled([api.getHealth(), api.getOllamaHealth(), api.getModels(), api.getAgents()]).then((results) => {
      if (!active) return;
      setState({ loading: false, errors: results.filter((result) => result.status === 'rejected').map((result) => result.reason), health: results[0].status === 'fulfilled' ? results[0].value : null, ollama: results[1].status === 'fulfilled' ? results[1].value : null, models: results[2].status === 'fulfilled' ? results[2].value : null, agents: results[3].status === 'fulfilled' ? results[3].value.agents || [] : [] });
    });
    return () => { active = false; };
  }, [api]);
  return state;
}
