// Función temporal para contar Pokémon por tipo desde lock_status.json
function countPokemonByType() {
    try {
        const lockStatus = JSON.parse(fs.readFileSync(lockStatusPath, 'utf-8'));
        let counts = {
            public: 0,
            private: 0
        };
        
        for (const [_, status] of Object.entries(lockStatus)) {
            if (status.is_locked) {
                if (status.lock_type === 'public') {
                    counts.public++;
                } else if (status.lock_type === 'private') {
                    counts.private++;
                }
            }
        }
        
        return counts;
    } catch (error) {
        console.error("❌ Error al contar Pokémon:", error);
        return { public: 0, private: 0 };
    }
}