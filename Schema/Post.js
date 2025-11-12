import mongoose, { Schema } from "mongoose";

const postSchema = mongoose.Schema({

    text: {
        type: String,
        default: ""
    },
    image: {
        type: String,
        default: ""
        // required: true,
    },
    community: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: 'communities'
    },
    post_by: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: 'users'
    },
    community_admin: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: "users",
    }

}, 
{ 
    timestamps: true 
})

export default mongoose.model("posts", postSchema);