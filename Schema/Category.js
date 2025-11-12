import mongoose, { Schema } from "mongoose";

const categorySchema = mongoose.Schema({

    name: {
        type: String,
        required: true,
        unique: true,
    },
    blog_count: {
        type: Number,
        default: 0
    }

})

export default mongoose.model("categories", categorySchema);