async function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchData(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.error(`HTTP error! status: ${response.status} for url: ${url}`);
            return null;
        }
        return await response.json();
    } catch (error) {
        console.error(`Fetch error for url: ${url}`, error);
        return null;
    }
};

async function getPlayerUUID(username) {
    const ASHCON_API_URL = `https://api.ashcon.app/mojang/v2/user/${username}`;
    const MOJANG_API_URL = `https://api.mojang.com/users/profiles/minecraft/${username}`;
    const MAX_ATTEMPTS = 3;
    const RETRY_DELAY = 1000;
    let attempts = 0;

    while (attempts < MAX_ATTEMPTS) {
        const data = await fetchData(ASHCON_API_URL);
        if (data && data.uuid) return data.uuid;
        attempts++;
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }

    const mojangData = await fetchData(MOJANG_API_URL);
    if (mojangData && mojangData.id) return mojangData.id;

    throw new Error(`Could not retrieve UUID for ${username}`);
}

module.exports = {
    getPlayerUUID
};
