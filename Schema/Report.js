import mongoose, { Schema } from "mongoose";

const reportSchema = mongoose.Schema({

    reported_by: {
        type: Schema.Types.ObjectId,
        ref: 'users',
        required: true
    },
    type: {
        type: String,
        enum: ["user", "blog", "comment"],
        required: true
    },
    user: {
        type: Schema.Types.ObjectId,
        ref: 'users',
        required: true
    },
    link: {
        type: String || null,
        default: null
    },
    content: {
        type: String || null,
        default: null
    },
    ref: {
        type: String || null,
        default: null
    },
    parent_ref: { // for replies
        type: String || null,
        default: null
    },
    blog_ref: { // for comments
        type: String || null,
        default: null
    },
    reason: {
        type: String,
        required: true
    }

}, 
{ 
    timestamps: true

})

export default mongoose.model("reports", reportSchema);