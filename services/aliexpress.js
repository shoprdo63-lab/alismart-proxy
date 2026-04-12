import axios from 'axios';

/**
 * פונקציה שמחלצת מזהי מוצרים (Product IDs) מתוצאות חיפוש ויזואלי
 */
async function getIdsByImage(imageUrl) {
    try {
        // הכתובת של עלי-אקספרס לחיפוש תמונות
        const url = `https://www.aliexpress.com/fn/search-image/index?imageAddress=${encodeURIComponent(imageUrl)}`;

        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7'
            }
        });

        // חיפוש מזהי מוצר בתוך ה-HTML שחוזר (באמצעות Regex)
        const html = response.data;
        const regex = /"productId":"(\d+)"/g;
        const matches = [...html.matchAll(regex)];
        
        // הוצאת המספרים בלבד והסרת כפילויות
        const productIds = [...new Set(matches.map(match => match[1]))];

        return productIds;
    } catch (error) {
        console.error('Error fetching AliExpress image search:', error.message);
        return [];
    }
}

export { getIdsByImage };
