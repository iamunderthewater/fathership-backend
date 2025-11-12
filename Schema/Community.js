import mongoose, { Schema } from "mongoose";

const communitySchema = mongoose.Schema({

    community_id: {
        type: String,
        required: true,
        unique: true,
    },
    name: {
        type: String,
        required: true,
    },
    banner: {
        type: String,
        // required: true,
    },
    image: {
        type: String,
        required: true
    },
    des: {
        type: String,
        required: true
    },
    admin: {
        type: Schema.Types.ObjectId,
        ref: 'users'
    },
    members: {
        type: [Schema.Types.ObjectId],
        ref: 'users'
    },
    interests: {
        type: [String],
        required: true
    },

}, 
{ 
    timestamps: true 
})

export default mongoose.model("communities", communitySchema);