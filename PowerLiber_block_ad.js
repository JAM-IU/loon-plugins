// PowerLiber Ad Blocker v1.0
// Intercepts ad-related API responses and returns "no ad" data

const url = $request.url;

if (url.indexOf('/common/check-ad') !== -1) {
    // Pretend no ads to show
    $done({
        body: JSON.stringify({
            code: 0,
            data: {
                flag_ad: 0,
                flag_ad_after_pay: 0
            }
        })
    });
} else if (url.indexOf('/ad-rule/detail') !== -1) {
    // Return empty ad rules
    $done({
        body: JSON.stringify({
            code: 0,
            data: {
                id: 0,
                config: '{"ban_key":"flag_all","ban_list":["flag_all"]}'
            }
        })
    });
} else if (url.indexOf('/ad-config/all') !== -1) {
    // Return empty ad config
    $done({
        body: JSON.stringify({
            code: 0,
            data: []
        })
    });
} else {
    $done({});
}
