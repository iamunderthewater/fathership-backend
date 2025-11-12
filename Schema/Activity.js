import mongoose, { Schema } from "mongoose";

const activitySchema = mongoose.Schema({

    user: {
        type: Schema.Types.ObjectId,
        ref: 'users',
        required: true
    },
    type: {
        type: String,
        enum: ["user", "blog", "comment"],
        required: true
    },
    action: {
        type: String,
        enum: ["joined", "published", "updated", "commented", "replied", "deleted"],
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
    parent_ref: {
        type: String || null,
        default: null
    },
    blog_ref: {
        type: String || null,
        default: null
    }

}, 
{ 
    timestamps: true

})

export default mongoose.model("activities", activitySchema);