export const NOT_IOU = {
    $or: [
        {iou: {$exists: false}},
        {iou: null}
    ]
}
