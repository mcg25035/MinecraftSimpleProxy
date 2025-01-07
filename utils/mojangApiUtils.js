async function getPlayerUUID(username) {
    const response = await fetch(`https://api.mojang.com/users/profiles/minecraft/${username}`);
    if (!response.ok) {
        return null;
    }
    const data = await response.json();
    return data.id;
}

module.exports = {
    getPlayerUUID
};
